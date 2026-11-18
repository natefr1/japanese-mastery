# Japanese Mastery — 日本語マスター

A local-first Windows desktop app for learning Japanese: a fast **Study Center (学習センター)** combined with **生活**, a slice-of-life RPG where you use the language.

This release is **Milestone 2: Study Center + the start of 生活**, including a manga reading track. See [`docs/STATUS.md`](docs/STATUS.md) for what's complete and what's next, and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it fits together.

## Requirements (Windows 11)

| Tool | Version | Install |
|---|---|---|
| Rust | 1.77+ (stable) | https://rustup.rs (choose the MSVC toolchain) |
| MSVC Build Tools | 2022 | "Desktop development with C++" workload in the Visual Studio Installer |
| WebView2 | any | Preinstalled on Windows 11 |
| Node.js | 20+ | https://nodejs.org |

## Run it

```powershell
npm install
npm run tauri dev        # development build with hot reload
```

On first launch the app creates its database in `%APPDATA%\com.natefr1.japanesemastery\` and imports the 385 words from the original website.

## Build the installer

```powershell
npm run tauri build
```

The installers are written to `target\release\bundle\nsis\` (`.exe`) and `target\release\bundle\msi\` (`.msi`).

## Updates

The app updates itself from GitHub Releases. The one-time setup and how to publish a new version are in [`docs/UPDATES.md`](docs/UPDATES.md).

## Tests

```powershell
npm test                 # TypeScript: conjugation engine (vitest)
npm run test:rust        # Rust: migrations, seed, vocab CRUD, backups/restore/recovery, import/export
npm run typecheck
```

## Keyboard

| Keys | Action |
|---|---|
| `Ctrl+1` … `Ctrl+6` | Home / Study Center / 生活 / Vocabulary / Data & Backups / Settings |
| `Space` / `Enter` | Reveal or check an answer |
| `1`–`4` | Again / Hard / Good / Easy (`Enter` accepts the suggested rating) |
| `Esc` | End a session (goes to the summary) |
| `/` | Focus vocabulary search |
| `Ctrl+N` | Add a word |
| `Esc` | Close a dialog |

## Your data

- Everything is stored locally in SQLite. There is no account and no cloud.
- Backups are taken **daily**, **before every import**, **before every restore**, and **before any database update**. You can also back up manually from *Data & Backups*.
- Every backup has a SHA-256 checksum and passes an SQLite integrity check before it counts as valid.
- If the database is ever damaged, the app moves it aside (it is never deleted) and restores the newest valid backup automatically.
- Export to JSON (lossless, keeps ids) or CSV (for Excel or Sheets) at any time.

## Listening (optional)

Listening practice uses Windows' built-in Japanese voices. If none is installed: **Settings → Time & language → Speech → Add voices → Japanese**.

## External services

None so far. Everything works offline. AI providers come in Milestone 5; they will be optional, ask before sending anything, and keep API keys in the Windows Credential Manager rather than in settings.

## Repository layout

```
crates/jm-core/      Rust core: schema, migrations, seed, vocab, backups, import/export (+ tests)
src-tauri/           Tauri 2 shell: thin command layer over jm-core
src/                 React + TypeScript UI
  lib/               API bindings, types, conjugation engine (+ tests), settings
  components/        Shared UI (cards, editor, modal, toasts, icons)
  lib/learning/      FSRS adapter, session planner, answer checking (+ tests)
  lib/game/          Quest engine, authored quests, characters (+ tests)
  lib/reading/       Tokenizer + reading coverage (+ tests)
  pages/study/       Study Center, session, grammar, kanji, listening, stats, reader, onboarding
  pages/life/        生活 map, quest player (phone + scene), avatars
  pages/             Home, Vocabulary, Data & Backups, Settings
scripts/             copy-kuromoji-dict.mjs (runs before dev/build)
legacy/website/      The original vocabulary website, kept unchanged for reference
docs/                Architecture and status
```
