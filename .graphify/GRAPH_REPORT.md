# Graph Report - .  (2026-05-07)

## Corpus Check
- 77 files · ~1,44,982 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 703 nodes · 1124 edges · 27 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output


## Input Scope
- Requested: auto
- Resolved: all (source: default-auto)
- Included files: 77 · Candidates: recursive
- Excluded: 0 untracked · 0 ignored · 0 sensitive · 0 missing committed
## God Nodes (most connected - your core abstractions)
1. `BrowserController` - 63 edges
2. `RendererAutomationController` - 32 edges
3. `runAgent()` - 19 edges
4. `saveDb()` - 13 edges
5. `applyExecutionHeuristics()` - 9 edges
6. `augmentTaskForRecruiting()` - 8 edges
7. `DailyMemory` - 8 edges
8. `Yd()` - 7 edges
9. `Yd()` - 7 edges
10. `Xd()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `callOpenRouter()` --calls--> `normalizeUsage()`  [EXTRACTED]
  scratch/chat_cleanup_quarantine_20260503_020205/revert_backups/dist_1777753775907/main/main/openrouter.js → src/main/openrouter.ts
- `callOpenRouter()` --calls--> `parseAgentResponse()`  [EXTRACTED]
  scratch/chat_cleanup_quarantine_20260503_020205/revert_backups/dist_1777753775907/main/main/openrouter.js → src/main/openrouter.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (1): BrowserController

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (16): formatBytes(), isProbablyText(), pickAndPrepareAgentAttachments(), prepareAttachment(), parseDomainProfileMap(), setupIPC(), buildCookieUrl(), configureEmbeddedBrowserSecurity() (+8 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (42): addRoleVariants(), applyExecutionHeuristics(), augmentTaskForRecruiting(), augmentTaskForStructuredOutput(), buildActionSignature(), buildAttachmentPrompt(), buildContinuityContext(), buildStateFingerprint() (+34 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (4): delay(), registerBridgeAction(), shouldThrottleBridgeAction(), waitForWebviewSettle()

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (1): RendererAutomationController

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (11): f(), Fi(), Gd(), Hd(), j(), Kd(), Vd(), Wd() (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (11): f(), Fi(), Gd(), Hd(), j(), Kd(), Vd(), Wd() (+3 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (11): f(), Fi(), Gd(), Hd(), Kd(), N(), Vd(), Wd() (+3 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (11): f(), Fi(), Gd(), Hd(), Kd(), N(), Vd(), Wd() (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (11): f(), Fi(), Gd(), Hd(), j(), Kd(), Vd(), Wd() (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (11): C(), f(), Fi(), Gd(), Hd(), Kd(), Vd(), Wd() (+3 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (9): Gd(), Hd(), Ii(), p(), Qd(), Wd(), Xd(), Yd() (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (9): Gd(), Hd(), Ii(), p(), Qd(), Wd(), Xd(), Yd() (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (11): C(), ce(), f(), Fi(), Gd(), Qd(), Vd(), Wd() (+3 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (11): bi(), E(), f(), Gd(), Hd(), Oi(), Qd(), Wd() (+3 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (9): f(), Fi(), Gd(), Qd(), Vd(), Wd(), Xd(), Yd() (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (9): f(), Fi(), Gd(), Qd(), Vd(), Wd(), Xd(), Yd() (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (9): f(), Fi(), Gd(), Qd(), Vd(), Wd(), Xd(), Yd() (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (11): ef(), Gi(), Jd(), lf(), nf(), O(), of(), p() (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.22
Nodes (18): addCreditUsage(), addHistoryEntry(), addMemory(), addStep(), clearAllMemories(), createTask(), deleteChatSession(), getAllMemories() (+10 more)

### Community 20 - "Community 20"
Cohesion: 0.14
Nodes (3): AgentExecutor, BrowserManager, BronApp

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (8): callLLM(), callOpenRouter(), enhancePrompt(), fetchOpenRouterModels(), mergeWithFallbacks(), normalizeUsage(), numberOrZero(), parseAgentResponse()

### Community 22 - "Community 22"
Cohesion: 0.2
Nodes (4): createWindow(), resolveRendererHtmlPath(), startCookieSync(), syncCookies()

### Community 23 - "Community 23"
Cohesion: 0.33
Nodes (1): DailyMemory

### Community 24 - "Community 24"
Cohesion: 0.32
Nodes (4): Initialize-CodexMultiAgent(), Invoke-External(), Invoke-Graphify(), Write-Info()

### Community 25 - "Community 25"
Cohesion: 0.6
Nodes (1): CoreMemory

### Community 26 - "Community 26"
Cohesion: 0.5
Nodes (1): Soul

## Knowledge Gaps
- **Thin community `Community 0`** (1 nodes): `BrowserController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 4`** (1 nodes): `RendererAutomationController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `DailyMemory`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `CoreMemory`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `Soul`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `BrowserController` connect `Community 0` to `Community 1`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `RendererAutomationController` connect `Community 4` to `Community 1`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._