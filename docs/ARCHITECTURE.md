# Architecture

## Layers

```
┌──────────────────────────── React + TS (src/) ────────────────────────────┐
│ pages/ components/      UI only                                            │
│ lib/conjugation.ts      pure language logic (deterministic, unit-tested)   │
│ lib/api.ts              typed invoke() wrappers, the only path to data     │
│ (M2) lib/learning/      FSRS scheduling via ts-fsrs, session planning      │
│ (M3) lib/game/          XP / mastery / currency rules (pure, tested)       │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ Tauri IPC (commands)
┌──────────────── src-tauri/ (Rust shell) ──────────────────────────────────┐
│ Command handlers only. Resolves %APPDATA%, opens Db, runs daily backup.    │
└───────────────────────────────┬───────────────────────────────────────────┘
┌──────────────── crates/jm-core (Rust, no UI/Tauri deps) ──────────────────┐
│ db.rs          open, PRAGMAs, recovery, transaction wrapper                │
│ migrations.rs  versioned transactional migrations (user_version)          │
│ vocab.rs       items, examples, tags (composable inside transactions)     │
│ seed.rs        385 website words, applied once, deterministic UUIDv5 ids  │
│ backup.rs      online backup API, manifest + SHA-256, verify, restore     │
│ io.rs          JSON/CSV import/export (atomic file writes, 1-tx imports)  │
│ events.rs      append-only domain event log                               │
│ settings.rs    JSON key/value settings (refuses secrets)                  │
└───────────────────────────────────────────────────────────────────────────┘
```

**Why persistence lives in Rust (rusqlite) rather than `tauri-plugin-sql`:** multi-statement operations such as an import, or saving an item together with its examples and tags, have to be one transaction. The SQLite backup and restore API and integrity checks are also only available here. And a plain Rust crate can be tested without a window, and can later be reused by a mobile companion or a sync service.

**Planned division for Milestone 2:** FSRS calculations run in TypeScript with `ts-fsrs`, a maintained, validated implementation. Rust stores each card's state and its review-log row in a single transaction. The scheduler is deterministic: AI-generated practice can add *extra* exercises but never edits FSRS state.

## Data model and sync readiness

Every syncable table has the following columns:

| Column | Purpose |
|---|---|
| `id TEXT` | Stable UUID. Seed words use UUIDv5 so every device derives the same id. |
| `created_at`, `updated_at` | Unix milliseconds |
| `deleted_at` | Tombstone (logical delete). Rows are never physically deleted by the app. |
| `rev` | Per-row revision counter, bumped on every change |
| `device_id` | Device that made the last change (each install gets a UUID in `meta`) |

The `events` table is an append-only log (`vocab.created`, `vocab.updated`, `vocab.deleted`, …). Milestone 2 adds `review_logs`, which is also append-only. A future sync engine can merge these per row (rev / `updated_at` / `device_id`) and replay events instead of overwriting one device with another. **Cloud sync is intentionally not implemented.**

Tables in schema v1: `meta`, `schema_migrations`, `vocab_items`, `vocab_examples`, `tags`, `vocab_tags`, `decks`, `deck_items`, `settings`, `events`.

### Schema v2 (migration 0002)

- `cards (item_type, item_id, skill, FSRS state…)`: one card per item and skill (`recognition`, `production`, or grammar `cloze`). Ids are UUIDv5 of `item_type|item_id|skill`, so every device derives the same card id.
- `review_logs`: append-only. Rating, scheduler state before and after, response ms, typed answer, auto-check result, session and source (`review` or `placement`).
- `study_sessions`, `grammar_points`, `kanji`, `reading_samples`, `vocab_items.freq_rank`.
- Progression: `reward_ledger` (append-only, `xp` or `yen`, balance = sum), `quest_progress`, `quest_runs` (append-only), `characters`, `character_memories`, `passport_entries`.

## Learning layer (M2)

```
ts-fsrs (validated FSRS) ──► lib/learning/fsrs.ts  (adapter only: CardRow ⇄ ts-fsrs Card)
lib/learning/planner.ts     which cards, how many new: deterministic, explains every throttle
lib/learning/answers.ts     typed-answer normalisation (kana/kanji/romaji), near-miss, suggested rating
Session.tsx                 runs the queue → ts-fsrs computes the next state → review_submit
jm-core study.rs            one transaction: rev check + range validation + log insert + card update + XP
```

- **FSRS is never re-implemented.** Rust stores what ts-fsrs computed and rejects impossible output (bad ranges, reps not +1, stale rev).
- **Mastery is derived, not stored**: counts of cards with stability ≥7 or ≥21 days per skill, plus true retention from the log (non-Again share on Review-state cards).
- AI (M5) may add *supplemental* practice but has no write path to card state.

## Progression rules (jm-core game.rs)

- XP: new card 5, pass 3, Again 1. Each card earns XP once per day. Review XP is capped at 400/day. Session bonus 10 needs ≥10 answers (counted from the log). The daily goal (counted from the log) gives 20 XP + ¥30.
- Quests: payouts come from a server-side table, not the client. The first completion gives full XP + ¥. Replays give ¼ XP once a day and no ¥. Relationship changes apply only on first completion and are clamped to −3…+5 per quest.
- Currency can't affect mastery or unlock learning content.

## 生活 quest engine (lib/game/quests.ts)

Authored graph of nodes. Each node has lines and either choices or typed input (intent patterns, matched after kana/romaji normalisation). It also supports `random` sequences (seeded PRNG, for replay variation), flags that change later lines, objectives (some only exist if their node was visited), and a success predicate per quest. Results separate **language feedback** (what to say more naturally) from **social effects** (tone → friendship). The engine is pure and unit-tested, and the UI is just a renderer.

## Social layer (v0.3.0)

**jm-core (pure, tested, no network):**
- `npc.rs` — 8 character profiles (`seed/npc_v1.json`), relationship state (closeness, trust, shared experiences, meaningful days; ≤6 updates/day, clamped deltas), formality stage per character with its own start/max/thresholds and a group offset.
- `chat.rs` — conversations, messages (`sent | scheduled | delivered`), receipts, typing (a scheduled row whose `typing_from` has passed), reactions, drafts, search, notifications, calls log, stickers, calendar, review observations, AI usage.
- `prompt.rs` — builds one prompt (system + user) per reply from: character profiles, current formality, a few retrieved memories, rolling summary, the last ~16 messages, local time, player name/status/level note. Parses the model's JSON strictly (caps: 5 bubbles DM, 4 group, 240 chars each; unknown stickers dropped). `plan_timing` turns a reply into read time, typing windows and delivery times.
- `memory.rs` — dedupe, relevance retrieval (keyword/CJK-bigram overlap + importance + confidence + verified − age).
- `scheduler.rs` — decides unprompted messages within hard limits (quiet hours, daily cap, gap, budgets, no double-texting, active hours) and records them as deduped events.
- `social.rs` — `prepare_reply` / `prepare_event` (DB → Job with prompt), `apply` (completion → scheduled rows, receipts, reaction, plan, memories, relationship), review/hint/summary helpers, and `Config` (one settings value, sanitised).

**src-tauri:**
- `ai.rs` — Anthropic Messages API (`POST /v1/messages`, `anthropic-version: 2023-06-01`), OpenAI (`api.openai.com/v1/chat/completions`, default `gpt-5-mini`), Groq (`api.groq.com/openai/v1`, default `openai/gpt-oss-120b`, free tier), Google Gemini via its OpenAI-compatible endpoint (`generativelanguage.googleapis.com/v1beta/openai`, default `gemini-flash-latest`, free tier OK), or any OpenAI-compatible server. Keys via `keyring` (Windows Credential Manager), never in settings/backups/logs. Errors are classified: not-ready (nothing sent), offline (retry with back-off), provider (shown to you).
- `engine.rs` — the runtime loop while the process lives: deliver due rows every second and emit `chat-changed`; every 2 s start replies for chats with pending player messages (debounced 1.8 s, one in flight per chat, DB lock never held across HTTP); every 30 s run due scheduler events; every 5 min a scheduler tick. Windows notifications when unfocused and outside quiet hours.
- Tray, close-to-tray, single instance, opt-in autostart (`--minimized`).

**Frontend:** `lib/game/worldNav.ts` (state machine + store), `pages/life/Seikatsu.tsx` (world layer, menus, panels), `Explore.tsx` (canvas exploration), `pages/life/phone/*` (ハナシ).

### AI cost and config
Each friend reply is one request (~2–4k input tokens, ≤800 output). Summaries run every 24 messages; reviews use the review model. With the defaults (Haiku-class chat model, 200 requests/day cap, 20 for unprompted messages) a heavy day of chatting is on the order of cents; check current pricing on Anthropic's site. Gemini Flash on the free tier costs nothing within Google's rate limits, but on the free tier Google may use the content to improve its products. A local Ollama/LM Studio model costs nothing and keeps everything on your PC, at lower quality. Set it all in Phone → 設定 → AI.

## Reading coverage (lib/reading)

kuromoji (IPADIC, offline) tokenizes text. Each token's dictionary form or reading is looked up against your vocabulary and its recognition card, giving known (Review state, stability ≥7d), learning, queued (in deck, not started) or unknown. Names are excluded. Particles, auxiliaries and dependent nouns count as grammar (known). Comfort labels follow reading research: 95% coverage is minimal comprehension, 98% comfortable.

## Durability and recovery

- `journal_mode=WAL`, `synchronous=FULL`, foreign keys on, 5-second busy timeout.
- Each migration runs in its own transaction. A backup is taken before migrating an existing database. The app refuses to open a database whose schema is newer than it understands, so you can't accidentally downgrade.
- Startup runs `quick_check`. If the file is damaged (*corrupt* or *not a database* errors only), it is moved aside as `*.corrupt-<ts>.sqlite` and the newest **verified** backup is restored. A merely locked file never triggers recovery.
- Backups are made with SQLite's online backup API. Each one is switched to single-file mode, integrity-checked, hashed, and renamed into place, and its manifest is written atomically.
- Restore verifies the backup first, takes a `pre-restore` backup of the current state, restores, then re-runs migrations.
- Imports are parsed fully before anything is written, a `pre-import` backup is taken, and the import is applied in one transaction.
- Exports are written to a temporary file and renamed.

## Privacy

- The webview CSP allows only the app itself and IPC; all network calls (updates, AI) are made from Rust.
- `settings` refuses keys that look like secrets. AI keys live in Windows Credential Manager (`keyring`).
- Nothing goes to an AI provider until you pick one **and** agree on the consent screen (consent is tied to the provider; switching asks again).
- Per request it sends only: that one chat's recent messages + summary, a few of that character's memories about you, your display name/status/level note, the fictional profile and the time of day. Never the vocabulary, reviews, other chats or backups.
- Conversation text is never logged. Error boundaries log the error message only.
- Delete controls: per-chat history, per-character memories (single/all), all chats, all memories, all review notes.

## Future: more languages (Korean, Chinese)

Planned so that adding a language is mostly content plus a few language-specific modules, not a rewrite:
- A `language` column (default `ja`) on vocab, grammar and character tables, added by a migration. Cards, reviews, FSRS, the planner, rewards, backups and updates are already language-agnostic.
- Per-language modules behind one interface: answer normalisation (kana/romaji for ja, Hangul jamo/romanisation for ko, pinyin and tones for zh), tokenizer for reading coverage (kuromoji for ja; e.g. a Korean morphological analyser or jieba-style segmenter for zh), conjugation (ja/ko only) and the TTS voice.
- Language selection in the shell. 生活 gets one world per language, or a shared world with language-specific characters.
