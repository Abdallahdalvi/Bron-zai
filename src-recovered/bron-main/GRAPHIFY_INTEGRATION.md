# Graphify Integration (Codex + Antigravity)

This setup enables Graphify in both Codex and Antigravity, then applies it to existing repositories.

## One-time global setup

Run in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-graphify-global.ps1
```

## If `graphify` is broken (`uv trampoline failed to canonicalize script path`)

Run the repair script once:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\repair-graphify-global.ps1
```

To re-apply project hooks in the current repo during repair:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\repair-graphify-global.ps1 -ReapplyProjectHooks
```

## Optional: include initial graph build for repos without graph files

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-graphify-global.ps1 -BuildInitialGraphs
```

## Optional: preview actions without making changes

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-graphify-global.ps1 -DryRun
```

## What the script does

1. Installs/upgrades `graphifyy` using `uv`
2. Runs Graphify global installs for:
   - `codex`
   - `antigravity`
3. Ensures Codex has:
   - `[features]`
   - `multi_agent = true`
4. Scans repository roots (`~/projects`, `~/source`, `~/repos`, `~/Desktop`)
5. Applies to every repo found:
   - `graphify codex install`
   - `graphify antigravity install`
   - `graphify hook install`
6. Creates/updates `.graphifyignore` with safe defaults

## For any brand-new repo later

Run once inside that repo:

```powershell
graphify codex install
graphify antigravity install
graphify hook install
```
