param(
  [switch]$ReapplyProjectHooks
)

$ErrorActionPreference = "Stop"

function Step([string]$msg) {
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Info([string]$msg) {
  Write-Host "  - $msg" -ForegroundColor Gray
}

function Ensure-Dir([string]$p) {
  if (-not (Test-Path $p)) {
    New-Item -Path $p -ItemType Directory -Force | Out-Null
  }
}

function Run([string]$exe) {
  $cmdArgs = $args
  & $exe @cmdArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($LASTEXITCODE): $exe $($cmdArgs -join ' ')"
  }
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw "uv is not installed. Install uv first, then rerun this script."
}

$userHome = $HOME
$uvRoot = Join-Path $userHome ".graphify-uv"
$uvCache = Join-Path $uvRoot "cache"
$uvTools = Join-Path $uvRoot "tools"
$uvBin = Join-Path $uvRoot "bin"

Ensure-Dir $uvRoot
Ensure-Dir $uvCache
Ensure-Dir $uvTools
Ensure-Dir $uvBin

Step "Configuring dedicated uv paths for Graphify"
[Environment]::SetEnvironmentVariable("UV_CACHE_DIR", $uvCache, "User")
[Environment]::SetEnvironmentVariable("UV_TOOL_DIR", $uvTools, "User")
[Environment]::SetEnvironmentVariable("UV_TOOL_BIN_DIR", $uvBin, "User")

Info "UV_CACHE_DIR=$uvCache"
Info "UV_TOOL_DIR=$uvTools"
Info "UV_TOOL_BIN_DIR=$uvBin"

# Ensure current process uses them right now.
$env:UV_CACHE_DIR = $uvCache
$env:UV_TOOL_DIR = $uvTools
$env:UV_TOOL_BIN_DIR = $uvBin

# Make sure graphify bin dir is on user PATH (prepend if missing).
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = @()
if ($userPath) { $parts = $userPath -split ';' | Where-Object { $_ -and $_.Trim() } }
if ($parts -notcontains $uvBin) {
  $newPath = ($uvBin + ';' + ($parts -join ';')).Trim(';')
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Info "Prepended Graphify bin directory to user PATH."
} else {
  Info "Graphify bin directory already in user PATH."
}

Step "Installing / repairing Graphify CLI"
Run "uv" "tool" "install" "graphifyy" "--force"

Step "Validating CLI"
Run "uv" "tool" "run" "--from" "graphifyy" "graphify" "--help"

Step "Installing Graphify integration for Codex + Antigravity"
Run "uv" "tool" "run" "--from" "graphifyy" "graphify" "install" "--platform" "codex"
Run "uv" "tool" "run" "--from" "graphifyy" "graphify" "antigravity" "install"

Step "Ensuring Codex multi-agent setting"
$codexDir = Join-Path $userHome ".codex"
$codexCfg = Join-Path $codexDir "config.toml"
Ensure-Dir $codexDir
if (-not (Test-Path $codexCfg)) {
  Set-Content -Path $codexCfg -Value "[features]`nmulti_agent = true`n"
  Info "Created new Codex config with multi_agent=true."
} else {
  $raw = Get-Content -Path $codexCfg -Raw
  if ($raw -match '(?m)^\s*multi_agent\s*=') {
    $updated = [regex]::Replace($raw, '(?m)^\s*multi_agent\s*=.*$', 'multi_agent = true')
    if ($updated -ne $raw) {
      Set-Content -Path $codexCfg -Value $updated
      Info "Updated existing multi_agent setting to true."
    } else {
      Info "multi_agent already true."
    }
  } elseif ($raw -match '(?m)^\[features\]\s*$') {
    $updated = [regex]::Replace($raw, '(?m)^\[features\]\s*$', "[features]`r`nmulti_agent = true")
    Set-Content -Path $codexCfg -Value $updated
    Info "Added multi_agent under [features]."
  } else {
    Set-Content -Path $codexCfg -Value ($raw + "`r`n`r`n[features]`r`nmulti_agent = true`r`n")
    Info "Appended [features] section with multi_agent=true."
  }
}

if ($ReapplyProjectHooks) {
  Step "Re-applying Graphify project hooks in current repository"
  Run "uv" "tool" "run" "--from" "graphifyy" "graphify" "codex" "install"
  Run "uv" "tool" "run" "--from" "graphifyy" "graphify" "antigravity" "install"
  Run "uv" "tool" "run" "--from" "graphifyy" "graphify" "hook" "install"
}

Write-Host ""
Write-Host "Graphify repair complete." -ForegroundColor Green
Write-Host "Close and reopen terminal/Codex/Antigravity so PATH/env changes apply." -ForegroundColor Green

