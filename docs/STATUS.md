# Status

## Verification

| Check | Result |
|---|---|
| `cargo test -p jm-core` | **35/35 pass**: migrations including the M1→M2 upgrade, seeds and packs, FSRS persistence, anti-farming rewards, quests, backups, recovery, import/export, reading samples |
| `npm test` (vitest) | **38/38 pass**: conjugation, answer checking, ts-fsrs adapter, session planner, quest engine (all 3 quests, variation, failure paths), reading coverage |
| `tsc --noEmit`, `vite build` | pass |
| Tauri shell (`src-tauri/`) | **not compiled here** because it needs the Windows toolchain. It's a thin command layer of 35 commands; compile errors, if any, will be in `src-tauri/src/lib.rs`. |
| Visual/UI testing | not done by me (you test the UI yourself) |

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

## Auto-updates ✅ (v0.2.0)

Tauri updater plugin with signed updates from GitHub Releases. CI builds and publishes on version tags and runs tests on every push. In the app: automatic check on launch (can be turned off), manual check, and a backup before install. Setup and release scripts: see `docs/UPDATES.md`. Not testable here; it works after the one-time setup and first release.

## External APIs

None, except the optional update check (GitHub Releases, no account or data sent). Everything else runs offline. Text-to-speech uses the voices installed in Windows.

## Data licences

- JMdict / KANJIDIC2: © EDRDG, **CC BY-SA 4.0**. Derived files: `crates/jm-core/seed/core_v1.json` and `kanji_v1.json`. The share-alike terms apply to those data files.
- kuromoji.js + IPADIC: Apache-2.0 (dictionary copied to `public/kuromoji/` at build time).
- ts-fsrs, WanaKana: MIT.
- Everything else (grammar, manga pack, website words, quests, art): original.
