# Status

## Verification (v0.3.0)

| Check | Result |
|---|---|
| `cargo test -p jm-core` | **62/62 pass**. Includes the new social layer: relationship deltas and limits, formality stages, scheduler bounds over simulated days, dedupe/expiry, full reply cycle (receipts → typing → bubbles → reaction → plan → memory), bounded groups, bad AI output → retry, reviews, local time |
| `npm test` (vitest) | **48/48 pass**. Includes the 生活 navigation state machine (open/close/reopen, Esc layering, 2,000-step random walk never leaves an empty screen) and exploration collisions/doors |
| `tsc --noEmit`, `vite build` | pass |
| Tauri shell (`src-tauri/`) | **compiles (`cargo check`, Linux, zero warnings)**. Windows-only bits (Credential Manager, toasts, autostart) are compiled for real only by the Windows release build. |
| Visual QA | Screenshots at 1366×768 and 1920×1080 with mocked data: world, phone chats, conversation, sticker picker, profile, settings, close-phone-returns-to-world, friends panel. **No live AI call was made here** (no key in this environment). |

## Milestone 1: Desktop foundation ✅

The original website is preserved, and SQLite, migrations, backups, recovery, import/export and the app shell are all in place. Details are in git history and README.

## Milestone 2: Study Center + start of 生活 ✅ (code complete)

### Study Center
| Feature | State | Notes |
|---|---|---|
| FSRS scheduling (ts-fsrs 5, FSRS-6) | ✅ | Real library. Again/Hard/Good/Easy with interval previews, target retention setting, fuzz, learning steps |
| Separate skills | ✅ | Each word has a *recognition* card and a *production* card. Production unlocks only after recognition graduates, so recognising a word never counts as producing it. |
| Append-only review log | ✅ | Before/after scheduler state, response time, typed answer, auto-check result, session id |
| Stale/duplicate protection | ✅ | Card `rev` check: a double-submitted answer is rejected, not double-counted. Scheduler output is range-checked. |
| Typed production + IME | ✅ | Kanji, kana or romaji accepted. Near-miss detection. Suggested rating (never Easy) that you can override. |
| Context cloze | ✅ | Example sentence with the word blanked, when the word appears verbatim |
| Adaptive session planner | ✅ | 5/12/25/custom minutes. Learning cards first, then lowest retrievability. New cards are throttled by backlog (≥60 → 3, ≥150 → 0) and by retention below target. A note explains every throttle. Production bias for your weak spot. |
| Grammar path | ✅ | **38 original points** (N5–N2, including 4 for manga speech). Formation, explanation, examples, common mistakes, comparisons, prerequisites, cloze practice |
| Kanji | ✅ | **1,411 kanji** (N5–N2 plus every kanji in your decks), linked to your words. Recognition cards, trace-writing pad (not graded) |
| Listening & shadowing | ✅ | Windows Japanese TTS, speed control, hidden transcript and translation, shadowing pause. No pronunciation scoring claimed. |
| Stats | ✅ | 30-day answers with Again share, retention per skill, response time per skill, weak items (suspend or drill), 14-day forecast |
| Language mastery | ✅ | Computed only from card evidence (known = stable ≥7 days, mature ≥21 days), per skill. Never stored, so it can't be bought or farmed. |
| Onboarding + placement | ✅ | Level, goals, interests, pace, retention, challenge level. The optional 15-word quick check saves your answers as **real** first reviews and doesn't award XP. |
| No-shame design | ✅ | No streak resets. "Studied X of last 7 days". Clear stopping points, Momentum and an "I'm bored" button. Focus mode hides the sidebar. |
| Decks / bulk management UI | ⏳ | Tables exist (decks, deck_items). UI is in M3. |
| Confusable-word comparisons | ⏳ | Grammar comparisons are done; vocabulary confusables come with Memory Detective (M3) |
| Pitch accent / recorded audio | ⏳ | Fields exist. No reliable licensed source bundled yet. |

### Manga reading track (added during M2)
| Feature | State | Notes |
|---|---|---|
| Core 3000 deck | ✅ | From JMdict (CC BY-SA). Ordered by frequency, re-weighted so spoken/general words beat news-only words. Correct readings, part-of-speech-based conjugation. |
| Manga speech pack | ✅ | **103 original entries**: rough speech (〜ねえ, てめえ, 〜やがる, 〜ちまう), sentence endings, SFX (ゴゴゴ, ドキッ, シーン), and genre vocabulary across your collection. Each has examples and notes. |
| Reader coverage check | ✅ | Paste a page, then offline tokenization (kuromoji). Shows the % known from **your real card state**, with research-based comfort thresholds (95% / 98%). Unknown words: add to the deck or "learn next". Per-series library with series coverage. |
| OCR from page images | ⏳ | Not yet. Text must be typed or pasted. Candidate for a later milestone (local OCR model). |
| Per-series word lists | ✗ by design | Not bundled (copyrighted text / third-party data). Import your own lists via CSV. |

### 生活 (first playable slice)
| Feature | State | Notes |
|---|---|---|
| Neighbourhood map | ✅ | Original SVG. Apartment (phone) and konbini are playable; café, station, shopping street and Haruto's place are shown as locked (honestly labelled). |
| Quest engine | ✅ | Deterministic, seeded variation, typed (IME/romaji intent matching) or choice answers, multiple acceptable answers, objectives, separate language and social feedback |
| Quests | ✅ | **Konbini** (random 3 of 4 cashier questions, ask-for-repeat recovery, number listening), **Haruto's game night** (casual texting, counter-proposals), **Mika's weekend plans** (flags change dialogue, a polite or flat refusal changes the outcome) |
| Characters | ✅ | Haruto and Mika (Ren locked) with personality and speech style. Friendship changes from social choices only, never grammar. |
| Structured memories | ✅ | Facts stored per character from quests; view and delete in the Friends tab |
| XP / level, ¥ currency | ✅ | Three separate tracks. Review XP once per card per day, capped at 400/day. Quest payouts set server-side; replays give ¼ XP once a day and no ¥. Session bonus and daily-goal reward counted from the review log, not from the client. |
| Language Passport | ✅ | Simulated (quests) and real-world (self-reported) entries, clearly distinguished |
| Tap-to-translate + save words | ✅ | Tap any line for EN, word glosses and TTS; "+ Study" adds the word to your deck |
| Sounds / level-up animation | ⏳ | M3 (with the cosmetics shop) |
| AI conversations | ⏳ | M5 (provider config, consent, credential storage) |

## v0.3.0: 生活 overhaul + ハナシ messaging ✅ (code complete, needs your testing)

| Area | State | Notes |
|---|---|---|
| Blank screen after closing the phone | ✅ fixed | Cause: 生活 swapped whole routes for the phone/quests, and one render error unmounted the entire app. Now the world is a base layer that never unmounts, overlays come from a tested state machine (`lib/game/worldNav.ts`), and error boundaries contain failures to one area. |
| ハナシ app | ✅ | Original branding (mark, name, teal palette). Splash, ホーム (friends/groups/profile), トーク (search, pin, mute, hide, unread, typing previews, drafts), 通話, スタンプ shop, お知らせ, 設定 |
| Free-form chat | ✅ | IME-safe composer (Enter never sends while converting), drafts saved, multi-message sends are debounced into one reply. No premade options anywhere in chat. |
| 8 AI characters | ✅ | Haruto, Mika, Ren, Yui, Sota, Aoi, Natsuki, Chihiro. Each has its own speech profile, schedule, reply speed, emoji/sticker habits and formality path. Formality comes from closeness + trust + shared experiences + days actually talked, not message count. Grammar mistakes never lower a relationship. |
| Presence | ✅ | 既読 at a simulated read time, typing indicator while composing, unread counts. All derived from stored rows, pushed by events. Some characters sometimes just read and reply later. |
| Stickers / emoji / kaomoji / reactions | ✅ | 3 original packs (36 stickers, vector-drawn), favorites (right-click), recents, ¥ purchase. Reactions on any message; characters react too. |
| Groups | ✅ | ゲーム部🎮 and 週末カフェ部☕. Max 4 messages per reply, and NPC messages never trigger more NPC messages (no loops). |
| Unprompted messages | ✅ | Bounded scheduler: quiet hours, ≤4/day (configurable), 60-min gap, no double-texting, active hours, plan follow-ups, dedupe keys, separate AI budget |
| Background / tray | ✅ | Close → tray (setting). Tray: Open, Pause character messages, Quit. Single instance. Opt-in "Start with Windows" (starts minimized). Windows notifications when the app isn't focused (outside quiet hours; preview can be hidden). Fully quit = nothing runs, nothing is back-dated. Offline → messages stay queued and retry with back-off. |
| Memory | ✅ | Per-character memories with importance, confidence and verified flag; relevance retrieval (only a few per reply). View, correct, add, delete, delete all, in each profile. Rolling conversation summaries. |
| Learning layer | ✅ | On demand only: 💡 hint (never writes the message for you), 調べる word lookup (offline readings + optional AI meaning), ふりかえり review separating errors / unnatural / natural casual / slang / success + vocab |
| Plans → Calendar | ✅ | When a chat makes a plan, it becomes a card in the chat and an entry in 予定; friends may follow up later |
| AI providers | ✅ | Anthropic (key in Windows Credential Manager) or any OpenAI-compatible server (Ollama/LM Studio, fully local). Explicit consent screen listing exactly what is and isn't sent; daily request budgets; usage shown. |
| Calls | ✅ honest | Not available (no voice provider). Tapping call logs an "unavailable" attempt; no call is ever faked. |
| 2D exploration | ✅ slice | Walkable street (WASD/arrows), wall sliding, doors with E. Apartment and konbini open; café, station and shopping street are visibly closed. Position saved. |
| Menus | ✅ | 地図, スマホ, 友だち (multi-dimensional, no affection bar), 日誌, 予定, 持ち物 (wallet, sticker packs), 部屋, 実績 (computed from real data), パスポート. Hotkeys M P F J C I. |
| Quests | ✅ | Typed-first now; example replies are an optional hint |
| Apartment decorating, shop items, more buildings | ⏳ | Shown as "later update", not faked |
| Voice chat / calls | ⏳ | Needs STT + TTS provider |
| Fully animated VN scenes | ⏳ | The konbini scene is still the M2 renderer |

## Auto-updates ✅ (v0.2.0)

Tauri updater plugin with signed updates from GitHub Releases. CI builds and publishes on version tags and runs tests on every push. In the app: automatic check on launch (can be turned off), manual check, and a backup before install. Setup and release scripts: see `docs/UPDATES.md`. Not testable here; it works after the one-time setup and first release.

## External APIs

- Update check (GitHub Releases, nothing sent).
- **Optional AI provider for 生活 chats** (off until you set it up and agree). See ARCHITECTURE → AI layer for what's sent and what it costs.
- Everything else runs offline. Text-to-speech uses the voices installed in Windows.

## Data licences

- JMdict / KANJIDIC2: © EDRDG, **CC BY-SA 4.0**. Derived files: `crates/jm-core/seed/core_v1.json` and `kanji_v1.json`. The share-alike terms apply to those data files.
- kuromoji.js + IPADIC: Apache-2.0 (dictionary copied to `public/kuromoji/` at build time).
- ts-fsrs, WanaKana: MIT.
- Everything else (grammar, manga pack, website words, quests, characters, ハナシ branding, sticker art, map art): original. No LINE assets, characters or screenshots content are used.
