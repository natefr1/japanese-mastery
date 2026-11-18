<#
  One-time setup for auto-updates. Run from the project folder in PowerShell:

      powershell -ExecutionPolicy Bypass -File scripts\setup-updater.ps1

  It will:
    1. Create an update-signing key in %USERPROFILE%\.tauri\ (never inside the project)
    2. Put the PUBLIC key into src-tauri\tauri.conf.json
    3. Create the GitHub repo (public), push the code, and store the PRIVATE key
       as GitHub Actions secrets so releases can be signed.
  Needs: git, Node (already installed) and the GitHub CLI (winget install GitHub.cli).
#>
param([string]$Repo = "natefr1/japanese-mastery")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "Missing '$cmd'. $hint" -ForegroundColor Red; exit 1 }
}
Need git "Install with: winget install Git.Git (then open a new PowerShell)"
Need gh  "Install with: winget install GitHub.cli (then open a new PowerShell)"
Need npx "Install Node.js LTS first."

gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Logging in to GitHub..." -ForegroundColor Cyan; gh auth login --web --git-protocol https }

# 1) Signing key (outside the repo). Losing it means installed copies can't verify future updates.
$keyDir = Join-Path $env:USERPROFILE ".tauri"
$keyPath = Join-Path $keyDir "japanese-mastery.key"
$pwPath = Join-Path $keyDir "japanese-mastery.password.txt"
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
if (-not (Test-Path $keyPath)) {
  $bytes = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $password = [Convert]::ToBase64String($bytes)
  Set-Content -Path $pwPath -Value $password -NoNewline
  Write-Host "Generating signing key..." -ForegroundColor Cyan
  npx tauri signer generate --ci -p $password -w $keyPath
} else {
  Write-Host "Using existing signing key at $keyPath" -ForegroundColor Yellow
  $password = Get-Content $pwPath -Raw
}

# 2) Public key into the app config
node scripts/set-updater-key.mjs "$keyPath.pub" $Repo
if ($LASTEXITCODE -ne 0) { exit 1 }

# 3) Git + GitHub repo + secrets
if (-not (Test-Path ".git")) { git init -b main | Out-Null }
git add -A
git diff --cached --quiet; if ($LASTEXITCODE -ne 0) { git commit -m "Set up auto-updates" | Out-Null }
gh repo view $Repo 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating public repo $Repo..." -ForegroundColor Cyan
  gh repo create $Repo --public --source . --remote origin --push --description "Japanese Mastery: desktop Japanese learning RPG"
} else {
  if (-not (git remote 2>$null | Select-String -Quiet "^origin$")) { git remote add origin "https://github.com/$Repo.git" }
  git push -u origin main
}
Get-Content $keyPath -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo $Repo
$password | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo $Repo
Write-Host "Signing secrets stored in GitHub." -ForegroundColor Green

Write-Host ""
Write-Host "Done. IMPORTANT: back up these two files somewhere safe (password manager / USB):" -ForegroundColor Yellow
Write-Host "  $keyPath"
Write-Host "  $pwPath"
Write-Host ""
Write-Host "Publish your first release with:   npm run release 0.2.0 -- `"First release`"" -ForegroundColor Cyan
