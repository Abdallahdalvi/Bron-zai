param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$asarExe = Join-Path $repoRoot "node_modules\.bin\asar.cmd"
$portableDir = Join-Path $repoRoot "release\Bron-win32-x64"
$portableAsar = Join-Path $portableDir "resources\app.asar"
$winUnpackedAsar = Join-Path $repoRoot "release\win-unpacked\resources\app.asar"
$portableZip = Join-Path $repoRoot "release\Bron-win32-x64-portable.zip"

if (-not (Test-Path $asarExe)) {
  throw "Missing asar tool at '$asarExe'. Run npm install first."
}

if (-not (Test-Path $portableAsar)) {
  throw "Base portable app not found at '$portableAsar'. Run 'npm run dist' once first."
}

if (-not $SkipBuild) {
  $maxBuildAttempts = 3
  $buildOk = $false
  for ($attempt = 1; $attempt -le $maxBuildAttempts; $attempt++) {
    Write-Host "Building app (attempt $attempt/$maxBuildAttempts)..." -ForegroundColor Cyan
    npm.cmd run build
    if ($LASTEXITCODE -eq 0) {
      $buildOk = $true
      break
    }
    if ($attempt -lt $maxBuildAttempts) {
      Write-Host "Build failed; retrying in 3 seconds..." -ForegroundColor Yellow
      Start-Sleep -Seconds 3
    }
  }
  if (-not $buildOk) {
    throw "Build failed after $maxBuildAttempts attempts."
  }
}

$tmpRoot = Join-Path $repoRoot ".tmp"
if (-not (Test-Path $tmpRoot)) {
  New-Item -ItemType Directory -Path $tmpRoot | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$workDir = Join-Path $tmpRoot "portable-repack-$stamp"
New-Item -ItemType Directory -Path $workDir | Out-Null

$extractDir = Join-Path $workDir "app"
New-Item -ItemType Directory -Path $extractDir | Out-Null

try {
  Write-Host "Extracting app.asar..." -ForegroundColor Cyan
  & $asarExe extract $portableAsar $extractDir
  if ($LASTEXITCODE -ne 0) {
    throw "asar extract failed."
  }

  Write-Host "Updating dist payload..." -ForegroundColor Cyan
  Copy-Item -Path (Join-Path $repoRoot "dist\*") -Destination (Join-Path $extractDir "dist\") -Recurse -Force

  Write-Host "Repacking app.asar..." -ForegroundColor Cyan
  & $asarExe pack $extractDir $portableAsar
  if ($LASTEXITCODE -ne 0) {
    throw "asar pack failed."
  }

  if (Test-Path $winUnpackedAsar) {
    Copy-Item -Path $portableAsar -Destination $winUnpackedAsar -Force
  }

  Write-Host "Creating portable zip..." -ForegroundColor Cyan
  if (Test-Path $portableZip) {
    Remove-Item $portableZip -Force
  }
  Compress-Archive -Path (Join-Path $portableDir "*") -DestinationPath $portableZip -Force

  Write-Host "Done." -ForegroundColor Green
  Write-Host "Portable EXE folder: $portableDir"
  Write-Host "Portable ZIP: $portableZip"
}
finally {
  if (Test-Path $workDir) {
    Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
  }
}
