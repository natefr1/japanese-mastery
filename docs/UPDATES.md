# Updates

Japanese Mastery updates itself from **GitHub Releases** of `natefr1/japanese-mastery` using Tauri's official updater plugin.

## How it works

1. You run `npm run release 0.3.0 -- "What changed"`. It bumps the version everywhere, commits, tags `v0.3.0` and pushes.
2. GitHub Actions (`.github/workflows/release.yml`) runs the tests, builds the Windows installer, **signs** the update with your private key, and publishes a Release with `latest.json`.
3. The installed app checks `releases/latest/download/latest.json`, either on launch (Settings → Updates, on by default) or when you click **Check for updates**.
4. If there's a newer version: **Back up, update & restart.** The app backs up the database, downloads the update, verifies its signature against the public key built into the app, installs it, and restarts. The new version migrates the database (taking another backup first).

The update check is the only network call the app makes, and you can turn it off.

## One-time setup (about 5 minutes)

```powershell
winget install GitHub.cli        # then open a new PowerShell
cd C:\dev\japanese-mastery
powershell -ExecutionPolicy Bypass -File scripts\setup-updater.ps1
npm run release 0.2.0 -- "First release"
```

The setup script:
- creates the signing key in `%USERPROFILE%\.tauri\` (outside the project, never committed)
- writes the public key into `src-tauri/tauri.conf.json`
- creates the **public** repo `natefr1/japanese-mastery`, pushes the code, and stores the private key and password as GitHub Actions secrets

When the first release finishes (Actions tab, about 10–15 minutes), download the `.exe` from the Release page once and install it. From then on, updates arrive inside the app.

> **Back up the key.** Copy `%USERPROFILE%\.tauri\japanese-mastery.key` and `japanese-mastery.password.txt` somewhere safe. Without them you can't sign updates that existing installs will accept, and you'd have to reinstall manually with a new key.

## Releasing later

```powershell
git add -A; git commit -m "M3 work"     # commit your changes first
npm run release 0.3.0 -- "Milestone 3: achievements, shop, Memory Detective"
```

Use semantic versions: patch (`0.3.1`) for fixes, minor (`0.4.0`) for milestones.

## Notes

- **Local builds** (`npm run tauri build`) don't need the key. Only CI creates the signed update files (`src-tauri/tauri.release.conf.json`).
- **SmartScreen:** the installer isn't code-signed with a paid certificate, so Windows warns on the *first* install ("More info → Run anyway"). In-app updates after that are verified by the updater signature.
- **Private code later?** Make this repo private and publish releases from a separate public repo. Change the endpoint with `node scripts/set-updater-key.mjs <key.pub> owner/releases-repo` and set `owner`/`repo` in the tauri-action step.
- **Tests run on every push** (`.github/workflows/ci.yml`), and must pass before a release is built.
