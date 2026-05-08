param(
  [string[]]$RepoRoots = @(),
  [switch]$BuildInitialGraphs,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Info {
  param([string]$Message)
  Write-Host "  - $Message" -ForegroundColor Gray
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string]$WorkingDirectory
  )

  $display = "$FilePath $($Arguments -join ' ')"
  if ($WorkingDirectory) {
    $display = "[$WorkingDirectory] $display"
  }

  if ($DryRun) {
    Write-Host "[dry-run] $display" -ForegroundColor Yellow
    return
  }

  Push-Location
  try {
    if ($WorkingDirectory) { Set-Location $WorkingDirectory }
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed ($LASTEXITCODE): $display"
    }
  } finally {
    Pop-Location
  }
}

function Ensure-CodexMultiAgent {
  $codexDir = Join-Path $HOME ".codex"
  $configPath = Join-Path $codexDir "config.toml"

  if ($DryRun) {
    Write-Host "[dry-run] ensure Codex multi_agent=true in $configPath" -ForegroundColor Yellow
    return
  }

  if (-not (Test-Path $codexDir)) {
    New-Item -Path $codexDir -ItemType Directory -Force | Out-Null
  }

  if (-not (Test-Path $configPath)) {
    Set-Content -Path $configPath -Value "[features]`nmulti_agent = true`n"
    Write-Info "Created $configPath with multi_agent enabled."
    return
  }

  $raw = Get-Content -Path $configPath -Raw
  if ($raw -match '(?m)^\s*multi_agent\s*=') {
    $updated = [regex]::Replace($raw, '(?m)^\s*multi_agent\s*=.*$', 'multi_agent = true')
    if ($updated -ne $raw) {
      Set-Content -Path $configPath -Value $updated
      Write-Info "Updated existing multi_agent setting to true."
    } else {
      Write-Info "multi_agent already set to true."
    }
    return
  }

  if ($raw -match '(?m)^\[features\]\s*$') {
    $updated = [regex]::Replace(
      $raw,
      '(?m)^\[features\]\s*$',
      "[features]`r`nmulti_agent = true"
    )
    Set-Content -Path $configPath -Value $updated
    Write-Info "Added multi_agent under [features]."
    return
  }

  $append = "$raw`r`n`r`n[features]`r`nmulti_agent = true`r`n"
  Set-Content -Path $configPath -Value $append
  Write-Info "Appended [features] section with multi_agent=true."
}

function Ensure-GraphifyIgnore {
  param([string]$RepoPath)

  $ignorePath = Join-Path $RepoPath ".graphifyignore"
  $defaults = @(
    ".git/",
    "node_modules/",
    ".next/",
    "dist/",
    "build/",
    "coverage/",
    ".venv/",
    "venv/",
    "__pycache__/",
    "*.log",
    "tmp/",
    ".cache/"
  )

  if (-not (Test-Path $ignorePath)) {
    if ($DryRun) {
      Write-Host "[dry-run] create $ignorePath" -ForegroundColor Yellow
      return
    }
    Set-Content -Path $ignorePath -Value ($defaults -join "`r`n")
    return
  }

  $existing = Get-Content -Path $ignorePath
  $missing = $defaults | Where-Object { $_ -notin $existing }
  if ($missing.Count -eq 0) { return }
  if ($DryRun) {
    Write-Host "[dry-run] append defaults to ${ignorePath}: $($missing -join ', ')" -ForegroundColor Yellow
    return
  }
  Add-Content -Path $ignorePath -Value ("`r`n" + ($missing -join "`r`n"))
}

function Get-RepositoriesFromRoots {
  param([string[]]$Roots)
  $repos = @()
  foreach ($root in $Roots) {
    if (-not (Test-Path $root)) { continue }
    $rootPath = (Resolve-Path $root).Path
    if (Test-Path (Join-Path $rootPath ".git")) {
      $repos += $rootPath
    }
    Get-ChildItem -Path $rootPath -Directory -Recurse -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq ".git" } |
      ForEach-Object {
        $repo = $_.Parent.FullName
        if ($repo) { $repos += $repo }
      }
  }
  return $repos | Where-Object { $_ } | Sort-Object -Unique
}

function Invoke-Graphify {
  param([string[]]$GraphArgs, [string]$WorkingDirectory)
  if (Get-Command graphify -ErrorAction SilentlyContinue) {
    Invoke-External -FilePath "graphify" -Arguments $GraphArgs -WorkingDirectory $WorkingDirectory
  } else {
    $wrapped = @("tool", "run", "--from", "graphifyy", "graphify") + $GraphArgs
    Invoke-External -FilePath "uv" -Arguments $wrapped -WorkingDirectory $WorkingDirectory
  }
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw "uv is required. Install from https://docs.astral.sh/uv/getting-started/installation/"
}

if ($RepoRoots.Count -eq 0) {
  $RepoRoots = @(
    (Join-Path $HOME "projects"),
    (Join-Path $HOME "source"),
    (Join-Path $HOME "repos"),
    (Join-Path $HOME "Desktop")
  ) | Where-Object { Test-Path $_ }
}

Write-Step "Installing / upgrading Graphify tool"
Invoke-External -FilePath "uv" -Arguments @("tool", "install", "graphifyy", "--upgrade")

Write-Step "Installing Codex + Antigravity Graphify integration globally"
Invoke-Graphify -GraphArgs @("install", "--platform", "codex")
Invoke-Graphify -GraphArgs @("antigravity", "install")

Write-Step "Ensuring Codex multi-agent support is enabled"
Ensure-CodexMultiAgent

Write-Step "Scanning repositories"
$repos = Get-RepositoriesFromRoots -Roots $RepoRoots
Write-Info ("Found {0} repositories under: {1}" -f $repos.Count, ($RepoRoots -join ", "))

$updated = 0
foreach ($repo in $repos) {
  Write-Step "Configuring repo: $repo"
  Ensure-GraphifyIgnore -RepoPath $repo
  Invoke-Graphify -GraphArgs @("codex", "install") -WorkingDirectory $repo
  Invoke-Graphify -GraphArgs @("antigravity", "install") -WorkingDirectory $repo
  Invoke-Graphify -GraphArgs @("hook", "install") -WorkingDirectory $repo

  if ($BuildInitialGraphs) {
    $graphPath = Join-Path $repo "graphify-out\graph.json"
    if (-not (Test-Path $graphPath)) {
      Invoke-Graphify -GraphArgs @(".") -WorkingDirectory $repo
    }
  }
  $updated++
}

Write-Host ""
Write-Host "Completed Graphify setup." -ForegroundColor Green
Write-Host "Repositories configured: $updated" -ForegroundColor Green
Write-Host "For new repos, run once after clone/init:" -ForegroundColor Gray
Write-Host "  graphify codex install" -ForegroundColor White
Write-Host "  graphify antigravity install" -ForegroundColor White
Write-Host "  graphify hook install" -ForegroundColor White
