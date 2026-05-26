import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Globe, Zap } from 'lucide-react';
import BrowserToolbar from './components/BrowserToolbar';
import AgentSidebar from './components/AgentSidebar';
import MemoryPanel from './components/MemoryPanel';
import SettingsPanel from './components/SettingsPanel';
import ChatHistory from './components/ChatHistory';
import HistoryPanel from './components/HistoryPanel';
import BookmarksPanel from './components/BookmarksPanel';
import WorkflowsPanel from './components/WorkflowsPanel';
import type { BookmarkEntry, BrowserViewportRect, ChatMessage, RuntimeContext, Settings as SettingsType, TabInfo } from '../shared/types';

const LOAD_SESSION_EVENT = 'bron:load-chat-session';
const DEFAULT_HOME_URL = 'https://www.google.com/';

function normalizeComparableUrl(url: string): string {
  return String(url || '').trim().replace(/\/$/, '').replace(/#.*$/, '');
}

function normalizeUrlInput(raw: string): string {
  const target = String(raw || '').trim();
  if (!target) return DEFAULT_HOME_URL;
  if (/^https?:\/\//i.test(target) || target.startsWith('about:')) return target;
  if (target.includes('.') && !target.includes(' ')) return `https://${target}`;
  return `https://www.google.com/search?q=${encodeURIComponent(target)}`;
}

function getSessionStorageKey(partition: string): string {
  return `bron-tabs:${partition || 'persist:bron-session'}`;
}

function mergeTabsForDisplay(entries: TabInfo[], priorTabs: TabInfo[]): TabInfo[] {
  const merged = entries.map((tab, index) => {
    const prior = priorTabs.find((entry) =>
      entry.id === tab.id || normalizeComparableUrl(entry.url) === normalizeComparableUrl(tab.url),
    );
    return {
      ...tab,
      pinned: tab.pinned ?? !!prior?.pinned,
      _index: index,
    } as TabInfo & { _index: number };
  });

  merged.sort((a, b) => {
    const pinDelta = Number(!!b.pinned) - Number(!!a.pinned);
    if (pinDelta !== 0) return pinDelta;
    return a._index - b._index;
  });

  return merged.map(({ _index, ...tab }) => tab);
}

export default function App() {
  const [tabs, setTabs] = useState<TabInfo[]>([
    { id: 'tab_initial', title: 'google.com', url: DEFAULT_HOME_URL, active: true, initialUrl: DEFAULT_HOME_URL },
  ]);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showMemory, setShowMemory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showWorkflows, setShowWorkflows] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentStepText, setAgentStepText] = useState<string | null>(null);
  const [agentElapsedMs, setAgentElapsedMs] = useState(0);
  const [agentStartedAt, setAgentStartedAt] = useState<number | null>(null);
  const [browserReady, setBrowserReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [controllerHealthy, setControllerHealthy] = useState(true);
  const [agentTabId, setAgentTabId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [runtimeContext, setRuntimeContext] = useState<RuntimeContext>({
    windowPartition: 'persist:bron-session',
    incognito: false,
    browserBackend: 'webcontentsview',
  });
  const [theme, setTheme] = useState<'light' | 'dark' | 'medium'>(
    (localStorage.getItem('bron-theme') as 'light' | 'dark' | 'medium') || 'dark',
  );
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);

  const activeTab = useMemo(() => tabs.find((tab) => tab.active) || tabs[0], [tabs]);
  const currentUrl = activeTab?.url || DEFAULT_HOME_URL;
  const browserViewportRef = useRef<HTMLDivElement | null>(null);
  const sessionRestoredRef = useRef(false);

  useEffect(() => {
    (window as any).bronToggleSidebar = () => setShowSidebar((prev) => !prev);
    return () => { delete (window as any).bronToggleSidebar; };
  }, []);

  const applyTabs = useCallback((incoming: TabInfo[]) => {
    setTabs((prev) => mergeTabsForDisplay(incoming, prev));
  }, []);

  const refreshBookmarks = useCallback(async () => {
    if (!window.bronAPI) return;
    try {
      const saved = await window.bronAPI.getBookmarks();
      setBookmarks(Array.isArray(saved) ? saved : []);
    } catch (err) {
      console.error('Failed to load bookmarks:', err);
    }
  }, []);

  const refreshState = useCallback(async () => {
    if (!window.bronAPI) {
      setControllerHealthy(true);
      return;
    }
    try {
      const remoteTabs = await window.bronAPI.getTabs();
      if (Array.isArray(remoteTabs) && remoteTabs.length > 0) {
        applyTabs(remoteTabs);
      }
      setControllerHealthy(true);
    } catch (err) {
      console.error('Failed to refresh browser state:', err);
      setControllerHealthy(false);
    } finally {
      setIsLoading(false);
    }
  }, [applyTabs]);

  const restoreHostedSession = useCallback(async (partition: string) => {
    if (!window.bronAPI || sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    const key = getSessionStorageKey(partition);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const storedTabs = Array.isArray(parsed?.tabs) ? parsed.tabs : [];
      if (!storedTabs.length) return;

      const remoteTabs = await window.bronAPI.getTabs();
      const onlyDefaultBootTab = remoteTabs.length === 1
        && normalizeComparableUrl(remoteTabs[0].url) === normalizeComparableUrl(DEFAULT_HOME_URL);
      if (!onlyDefaultBootTab) return;

      const normalizedStoredTabs = storedTabs
        .map((entry: any) => ({
          url: normalizeUrlInput(String(entry?.url || DEFAULT_HOME_URL)),
          pinned: !!entry?.pinned,
        }))
        .filter((entry: { url: string }) => !!entry.url);
      if (!normalizedStoredTabs.length) return;

      await window.bronAPI.navigate(normalizedStoredTabs[0].url);
      for (let i = 1; i < normalizedStoredTabs.length; i += 1) {
        await window.bronAPI.newTab(normalizedStoredTabs[i].url);
      }

      const rebuiltTabs = await window.bronAPI.getTabs();
      const merged = rebuiltTabs.map((tab, index) => ({
        ...tab,
        pinned: normalizedStoredTabs[index]?.pinned ?? tab.pinned,
      }));
      applyTabs(merged);

      const activeIndex = Math.max(
        0,
        normalizedStoredTabs.findIndex((_entry: any, index: number) => {
          const source = storedTabs[index];
          return String(source?.id || '') === String(parsed?.activeTabId || '');
        }),
      );
      const nextActive = merged[activeIndex] || merged[0];
      if (nextActive?.id) {
        await window.bronAPI.switchTab(nextActive.id);
      }
    } catch (err) {
      console.error('Failed to restore hosted session:', err);
    }
  }, [applyTabs]);

  useEffect(() => {
    refreshBookmarks();
  }, [refreshBookmarks]);

  useEffect(() => {
    const normalizedCurrent = normalizeComparableUrl(currentUrl);
    setIsBookmarked(bookmarks.some((entry) => normalizeComparableUrl(entry.url) === normalizedCurrent));
  }, [bookmarks, currentUrl]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bron-theme', theme);

    let color = '#121212';
    let symbolColor = '#e0e0e0';
    if (theme === 'light') {
      color = '#f8fafc';
      symbolColor = '#0f172a';
    } else if (theme === 'medium') {
      color = '#1e1b4b';
      symbolColor = '#f5f3ff';
    }
    if (window.bronAPI) {
      window.bronAPI.invoke('theme:update-overlay', { theme, color, symbolColor });
    }
  }, [theme]);

  useEffect(() => {
    if (!browserReady || !window.bronAPI) return;
    const host = browserViewportRef.current;
    if (!host) return;

    const hasOverlayOpen = !!(
      showSettings ||
      showMemory ||
      showChatHistory ||
      showHistory ||
      showBookmarks ||
      showWorkflows
    );

    let frame = 0;
    const pushViewport = () => {
      frame = 0;
      const rect = host.getBoundingClientRect();
      const viewport: BrowserViewportRect = {
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(rect.top)),
        width: hasOverlayOpen ? 0 : Math.max(0, Math.round(rect.width)),
        height: hasOverlayOpen ? 0 : Math.max(0, Math.round(rect.height)),
        activeTabId: activeTab?.id || null,
        sidebarOpen: showSidebar,
      };
      window.bronAPI.setBrowserViewport(viewport).catch(() => {});
    };

    const schedulePush = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(pushViewport);
    };

    const observer = new ResizeObserver(schedulePush);
    observer.observe(host);
    window.addEventListener('resize', schedulePush);
    schedulePush();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedulePush);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [
    activeTab?.id,
    browserReady,
    showSidebar,
    showSettings,
    showMemory,
    showChatHistory,
    showHistory,
    showBookmarks,
    showWorkflows
  ]);

  useEffect(() => {
    if (!window.bronAPI) return;

    const init = async () => {
      try {
        const [nextSettings, runtime] = await Promise.all([
          window.bronAPI.getSettings(),
          window.bronAPI.getRuntimeContext().catch(() => null),
        ]);
        setSettings(nextSettings);
        if (runtime) {
          setRuntimeContext(runtime);
          await restoreHostedSession(runtime.windowPartition || 'persist:bron-session');
        }
        await refreshState();
      } catch (err) {
        console.error('Failed to initialize browser shell:', err);
      } finally {
        setBrowserReady(true);
      }
    };

    void init();

    const unsubs = [
      window.bronAPI.onBrowserReady(() => {
        setBrowserReady(true);
        setControllerHealthy(true);
        void refreshState();
      }),
      window.bronAPI.onBrowserError((_: any, msg: string) => {
        console.error('Browser error:', msg);
        setControllerHealthy(false);
        setIsLoading(false);
      }),
      window.bronAPI.onAgentStep((_: any, data: any) => {
        if (data?.message) setAgentStepText(String(data.message));
        if (data?.agentTabId) setAgentTabId(String(data.agentTabId));
      }),
      window.bronAPI.onNewTabRequest((_: any, url: string) => {
        void handleNewTab(url);
      }),
      window.bronAPI.onTabUpdated((_: any, data: any) => {
        if (!Array.isArray(data)) return;
        applyTabs(data);
        setIsLoading(false);
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [applyTabs, refreshState, restoreHostedSession]);

  useEffect(() => {
    if (!agentRunning || !agentStartedAt) return;
    const timer = window.setInterval(() => {
      setAgentElapsedMs(Date.now() - agentStartedAt);
    }, 250);
    return () => window.clearInterval(timer);
  }, [agentRunning, agentStartedAt]);

  useEffect(() => {
    const key = getSessionStorageKey(runtimeContext.windowPartition || 'persist:bron-session');
    try {
      localStorage.setItem(key, JSON.stringify({
        activeTabId: activeTab?.id || null,
        tabs: tabs.map((tab) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          pinned: !!tab.pinned,
        })),
      }));
    } catch {
      // Ignore persistence errors.
    }
  }, [activeTab?.id, runtimeContext.windowPartition, tabs]);

  const handleAgentRunningChange = useCallback((running: boolean) => {
    setAgentRunning(running);
    if (running) {
      const now = Date.now();
      setAgentStartedAt(now);
      setAgentElapsedMs(0);
      return;
    }
    setAgentStartedAt(null);
    setAgentStepText(null);
    setAgentTabId(null);
    void refreshState();
  }, [refreshState]);

  const handleNavigate = useCallback(async (url: string) => {
    if (!window.bronAPI) return;
    setIsLoading(true);
    try {
      await window.bronAPI.navigate(normalizeUrlInput(url));
      await refreshState();
    } catch (err) {
      console.error('Failed to navigate:', err);
      setControllerHealthy(false);
      setIsLoading(false);
    }
  }, [refreshState]);

  const handleBack = useCallback(async () => {
    if (!window.bronAPI) return;
    setIsLoading(true);
    try {
      await window.bronAPI.goBack();
      await refreshState();
    } catch (err) {
      console.error('Failed to go back:', err);
      setControllerHealthy(false);
      setIsLoading(false);
    }
  }, [refreshState]);

  const handleForward = useCallback(async () => {
    if (!window.bronAPI) return;
    setIsLoading(true);
    try {
      await window.bronAPI.goForward();
      await refreshState();
    } catch (err) {
      console.error('Failed to go forward:', err);
      setControllerHealthy(false);
      setIsLoading(false);
    }
  }, [refreshState]);

  const handleRefresh = useCallback(async () => {
    if (!window.bronAPI) return;
    setIsLoading(true);
    try {
      await window.bronAPI.refresh();
      await refreshState();
    } catch (err) {
      console.error('Failed to refresh:', err);
      setControllerHealthy(false);
      setIsLoading(false);
    }
  }, [refreshState]);

  const handleNewTab = useCallback(async (initialUrl?: string): Promise<string | undefined> => {
    if (!window.bronAPI) return undefined;
    setIsLoading(true);
    try {
      const createdId = await window.bronAPI.newTab(normalizeUrlInput(initialUrl || DEFAULT_HOME_URL));
      await refreshState();
      return typeof createdId === 'string' ? createdId : undefined;
    } catch (err) {
      console.error('Failed to create tab:', err);
      setControllerHealthy(false);
      setIsLoading(false);
      return undefined;
    }
  }, [refreshState]);

  const handleCloseTab = useCallback(async (tabId: string) => {
    if (!window.bronAPI || tabs.length <= 1) return;
    setIsLoading(true);
    try {
      await window.bronAPI.closeTab(tabId);
      await refreshState();
    } catch (err) {
      console.error('Failed to close tab:', err);
      setControllerHealthy(false);
      setIsLoading(false);
    }
  }, [refreshState, tabs.length]);

  const handleSwitchTab = useCallback(async (tabId: string) => {
    if (!window.bronAPI || tabId === activeTab?.id) return;
    setIsLoading(true);
    try {
      await window.bronAPI.switchTab(tabId);
      await refreshState();
    } catch (err) {
      console.error('Failed to switch tab:', err);
      setControllerHealthy(false);
      setIsLoading(false);
    }
  }, [activeTab?.id, refreshState]);

  const handleTogglePinCurrentTab = useCallback(() => {
    if (!activeTab) return;
    setTabs((prev) => mergeTabsForDisplay(
      prev.map((tab) => (tab.id === activeTab.id ? { ...tab, pinned: !tab.pinned } : tab)),
      prev,
    ));
  }, [activeTab]);

  const handleToggleBookmark = useCallback(async () => {
    if (!window.bronAPI || !currentUrl || currentUrl.startsWith('about:')) return;
    const normalizedCurrent = normalizeComparableUrl(currentUrl);
    const existing = bookmarks.find((entry) => normalizeComparableUrl(entry.url) === normalizedCurrent);
    try {
      if (existing) {
        await window.bronAPI.removeBookmark(existing.id);
      } else {
        await window.bronAPI.createBookmark({
          url: currentUrl,
          title: activeTab?.title || currentUrl,
          folder: 'Bookmarks',
        });
      }
      await refreshBookmarks();
    } catch (err) {
      console.error('Failed to toggle bookmark:', err);
    }
  }, [activeTab?.title, bookmarks, currentUrl, refreshBookmarks]);

  const handleSwitchProfile = useCallback(async (profileName: string) => {
    if (!settings || !window.bronAPI) return;
    const next = { ...settings, browserProfile: profileName };
    try {
      setIsLoading(true);
      await window.bronAPI.saveSettings(next);
      setSettings(next);
      window.setTimeout(() => {
        void refreshState();
      }, 1500);
    } catch (err) {
      console.error('Failed to switch profile:', err);
    } finally {
      setIsLoading(false);
    }
  }, [refreshState, settings]);

  const handleZoomIn = useCallback(() => {
    window.bronAPI?.adjustBrowserZoom(0.1).catch(() => {});
  }, []);

  const handleZoomOut = useCallback(() => {
    window.bronAPI?.adjustBrowserZoom(-0.1).catch(() => {});
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-bron-bg font-sans selection:bg-bron-accent/30 text-bron-text">
      <BrowserToolbar
        url={currentUrl}
        tabs={tabs}
        onNavigate={handleNavigate}
        onBack={handleBack}
        onForward={handleForward}
        onRefresh={handleRefresh}
        onNewTab={() => { void handleNewTab(); }}
        onSwitchTab={(tabId) => { void handleSwitchTab(tabId); }}
        onCloseTab={(tabId) => { void handleCloseTab(tabId); }}
        onToggleSidebar={() => setShowSidebar((prev) => !prev)}
        onOpenSettings={() => setShowSettings(true)}
        sidebarOpen={showSidebar}
        isLoading={isLoading || agentRunning}
        agentRunning={agentRunning}
        agentElapsedMs={agentElapsedMs}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        currentProfile={settings?.browserProfile || 'default'}
        onSwitchProfile={handleSwitchProfile}
        onOpenHistory={() => setShowHistory(true)}
        onOpenBookmarks={() => {
          setShowBookmarks(true);
          void refreshBookmarks();
        }}
        onOpenWorkflows={() => setShowWorkflows(true)}
        onToggleBookmark={() => { void handleToggleBookmark(); }}
        onTogglePinCurrentTab={handleTogglePinCurrentTab}
        isBookmarked={isBookmarked}
        currentTheme={theme}
        onSwitchTheme={setTheme}
        onAbout={() => alert('Bron Agentic Browser v2.0\nBuilt by Abdallah Dalvi\n\nA powerful autonomous research tool.')}
      />

      <div className="flex-1 flex overflow-hidden min-w-0">
        <div className="flex-1 flex flex-col overflow-hidden transition-all duration-300 relative min-w-0">
          <div className={`flex-1 flex flex-col relative overflow-hidden transition-all duration-300 ${agentRunning ? 'p-[4px]' : ''}`}>
            {agentRunning && (
              <>
                <div className="aura-top aura-edge" />
                <div className="aura-bottom aura-edge" />
                <div className="aura-left aura-edge" />
                <div className="aura-right aura-edge" />
                <div className="aura-corner aura-corner-tl" />
                <div className="aura-corner aura-corner-tr" />
                <div className="aura-corner aura-corner-bl" />
                <div className="aura-corner aura-corner-br" />
              </>
            )}
            <div ref={browserViewportRef} className="flex-1 relative bg-bron-bg overflow-hidden shadow-2xl">
              {browserReady ? (
                <div className="w-full h-full relative">
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-bron-text-dim pointer-events-none">
                    Main-process browser view active
                  </div>

                {!controllerHealthy && (
                  <div className="absolute top-4 left-4 z-50 animate-slide-up">
                    <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-orange-500 text-white shadow-2xl border border-white/20 backdrop-blur-xl">
                      <AlertCircle className="w-5 h-5 animate-pulse" />
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-80">System Alert</span>
                        <span className="text-xs font-bold">Engine Reconnecting...</span>
                      </div>
                    </div>
                  </div>
                )}

                {agentRunning && agentStepText && (
                  <div className="absolute bottom-5 left-5 right-5 flex justify-center pointer-events-none z-40 animate-slide-up">
                    <div className="max-w-3xl w-full px-4 py-2.5 rounded-xl bg-slate-900/80 border border-white/10 text-white text-[12px] font-mono shadow-[0_12px_30px_rgba(0,0,0,0.35)] leading-relaxed text-center">
                      <span className="text-bron-accent font-black mr-2">{'>'}</span>
                      <span className="opacity-95">{agentStepText}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-10 bg-bron-panel relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.08)_0%,transparent_70%)] animate-pulse" />
                <div className="relative">
                  <div className="w-32 h-32 rounded-[3.5rem] bg-gradient-to-br from-bron-accent to-blue-600 flex items-center justify-center shadow-[0_30px_70px_rgba(59,130,246,0.4)] rotate-6 transition-transform hover:rotate-0 duration-700">
                    <Globe className="w-16 h-16 text-white" />
                  </div>
                  <div className="absolute -bottom-3 -right-3 w-12 h-12 rounded-2xl bg-bron-success flex items-center justify-center shadow-2xl border-4 border-bron-panel animate-bounce">
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div className="text-center space-y-3">
                  <h1 className="text-6xl font-black text-white tracking-tighter drop-shadow-2xl">BRON <span className="text-bron-accent text-2xl align-top ml-1 font-black">V2</span></h1>
                  <div className="h-[2px] w-24 bg-bron-accent mx-auto rounded-full shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                  <p className="text-bron-text-dim text-[10px] font-black uppercase tracking-[0.5em] opacity-40">Architectural Core v2.0.4</p>
                </div>
                <div className="flex flex-col items-center gap-6 w-80">
                  <div className="w-full h-2 bg-bron-surface/50 rounded-full overflow-hidden p-[2px] border border-white/5">
                    <div className="h-full bg-bron-accent rounded-full animate-loading-bar shadow-[0_0_20px_rgba(59,130,246,0.6)]" />
                  </div>
                  <p className="text-bron-text-muted text-[11px] font-black uppercase tracking-[0.3em] animate-pulse">Syncing Browser Context...</p>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>

        {showSidebar && (
          <AgentSidebar
            agentRunning={agentRunning}
            setAgentRunning={handleAgentRunningChange}
            onOpenMemory={() => setShowMemory(true)}
            onOpenHistory={() => setShowChatHistory(true)}
            onOpenWorkflows={() => setShowWorkflows(true)}
            onRefresh={refreshState}
          />
        )}
      </div>

      {showMemory && (
        <MemoryPanel
          onClose={() => setShowMemory(false)}
          onViewChat={async (sessionId) => {
            if (!window.bronAPI) return;
            const session = await window.bronAPI.getChatSession(sessionId);
            if (!session) return;
            window.dispatchEvent(new CustomEvent(LOAD_SESSION_EVENT, {
              detail: { messages: session.messages, sessionId },
            }));
            setShowMemory(false);
            setShowSidebar(true);
          }}
        />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showChatHistory && (
        <ChatHistory
          onClose={() => setShowChatHistory(false)}
          onLoadSession={(messages: ChatMessage[], sessionId: number) => {
            window.dispatchEvent(new CustomEvent(LOAD_SESSION_EVENT, {
              detail: { messages, sessionId },
            }));
            setShowChatHistory(false);
            setShowSidebar(true);
          }}
        />
      )}
      {showHistory && (
        <HistoryPanel
          onClose={() => setShowHistory(false)}
          onNavigate={(url) => {
            void handleNavigate(url);
            setShowHistory(false);
          }}
        />
      )}
      {showBookmarks && (
        <BookmarksPanel
          bookmarks={bookmarks}
          currentUrl={currentUrl}
          onClose={() => setShowBookmarks(false)}
          onNavigate={(url) => {
            void handleNavigate(url);
            setShowBookmarks(false);
          }}
          onRefresh={refreshBookmarks}
        />
      )}
      {showWorkflows && <WorkflowsPanel onClose={() => setShowWorkflows(false)} />}
    </div>
  );
}
