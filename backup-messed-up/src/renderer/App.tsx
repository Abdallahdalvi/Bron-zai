import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Bot, Globe, Zap, AlertCircle, X } from 'lucide-react';
import BrowserToolbar from './components/BrowserToolbar';
import AgentSidebar from './components/AgentSidebar';
import MemoryPanel from './components/MemoryPanel';
import SettingsPanel from './components/SettingsPanel';
import ChatHistory from './components/ChatHistory';
import HistoryPanel from './components/HistoryPanel';
import type { TabInfo, ChatMessage, ElectronWebview, Settings as SettingsType } from '../shared/types';

const LOAD_SESSION_EVENT = 'bron:load-chat-session';
const UNIFIED_AGENT_MODE = true;

export default function App() {
  const [tabs, setTabs] = useState<TabInfo[]>([
    { id: 'tab_initial', title: 'google.com', url: 'https://www.google.com/', active: true, initialUrl: 'https://www.google.com/' },
  ]);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showMemory, setShowMemory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  
  useEffect(() => {
    (window as any).bronToggleSidebar = () => setShowSidebar(prev => !prev);
    return () => { delete (window as any).bronToggleSidebar; };
  }, []);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentStepText, setAgentStepText] = useState<string | null>(null);
  const [agentElapsedMs, setAgentElapsedMs] = useState(0);
  const [agentStartedAt, setAgentStartedAt] = useState<number | null>(null);
  const [browserReady, setBrowserReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [controllerHealthy, setControllerHealthy] = useState(true);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [agentTabId, setAgentTabId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark' | 'medium'>(
    (localStorage.getItem('bron-theme') as any) || 'dark'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bron-theme', theme);
    
    // Update Electron Titlebar Overlay
    let color = '#121212';
    let symbolColor = '#e0e0e0';
    if (theme === 'light') {
      color = '#f8fafc';
      symbolColor = '#0f172a';
    } else if (theme === 'medium') {
      color = '#1e1b4b';
      symbolColor = '#f5f3ff';
    }
    window.bronAPI.invoke('theme:update-overlay', { theme, color, symbolColor });
  }, [theme]);

  const webviewRefs = useRef<Map<string, ElectronWebview>>(new Map());
  const webviewCleanupRefs = useRef<Map<string, () => void>>(new Map());
  const lastMirroredUrlRef = useRef<string>('');
  const lastExternalAuthUrlRef = useRef<string>('');
  const syncLockRef = useRef<boolean>(false);
  const bridgeAgentTabIdRef = useRef<string | null>(null);
  const bridgeActionStatsRef = useRef<Map<string, { count: number; lastAt: number }>>(new Map());

  const activeTab = useMemo(() => tabs.find(t => t.active) || tabs[0], [tabs]);
  const currentUrl = activeTab?.url || 'https://www.google.com';

  const refreshState = useCallback(async () => {
    if (UNIFIED_AGENT_MODE) {
      setControllerHealthy(true);
      return;
    }
    if (!window.bronAPI || agentRunning) return;
    try {
      const remoteTabs = await window.bronAPI.getTabs();
      if (Array.isArray(remoteTabs) && remoteTabs.length > 0) {
        setTabs(prev => {
          // If we have local tabs that are not in remote yet (newly created), preserve them
          // BUT: if we find a remote tab that was likely meant to replace a local tab (same URL and recent), we merge.
          const remoteIds = new Set(remoteTabs.map(t => t.id));
          
          // Merge remote tabs with local state
          const merged = remoteTabs.map(rt => {
            const local = prev.find(lt => lt.id === rt.id);
            if (local) {
              return { ...rt, active: local.active };
            }
            return rt;
          });

          // Filter out local-only tabs that have already been 'claimed' by a remote tab with the same ID
          const localOnly = prev.filter(t => !remoteIds.has(t.id) && t.id.startsWith('local_tab_'));

          // Deduplicate: if a merged tab has the same ID as a localOnly (shouldn't happen with RT.id match, but safe), or if it's redundant.
          return [...merged, ...localOnly];
        });
      }
      setControllerHealthy(true);
    } catch {
      setControllerHealthy(false);
    }
  }, [agentRunning]);

  useEffect(() => {
    if (!window.bronAPI) return;

    const init = async () => {
      try {
        const s = await window.bronAPI.getSettings();
        setSettings(s);
        await refreshState();
      } catch (err) {
        console.error('Initial refreshState failed:', err);
      } finally {
        setBrowserReady(true);
      }
    };
    init();

    const unsubs = [
      window.bronAPI.onBrowserReady(() => {
        setBrowserReady(true);
        setControllerHealthy(true);
        refreshState();
      }),
      window.bronAPI.onBrowserError((_: any, msg: string) => {
        console.error('Browser error:', msg);
        setControllerHealthy(false);
      }),
      window.bronAPI.onAgentStep((_: any, data: any) => {
        if (data.message) setAgentStepText(data.message);
        if (data.agentTabId) setAgentTabId(data.agentTabId);
      }),
      window.bronAPI.onNewTabRequest((_: any, url: string) => {
        handleNewTab(url);
      }),
    ];

    return () => unsubs.forEach((un) => un());
  }, [refreshState]);

  useEffect(() => {
    return () => {
      for (const cleanup of webviewCleanupRefs.current.values()) {
        cleanup();
      }
      webviewCleanupRefs.current.clear();
      webviewRefs.current.clear();
    };
  }, []);

  useEffect(() => {
    // Automatically zoom out slightly when sidebar is open to preserve layout
    const zoomFactor = showSidebar ? 0.85 : 1.0;
    webviewRefs.current.forEach(wv => {
      try {
        wv.setZoomFactor(zoomFactor);
      } catch (e) {
        // May fail if webview not ready
      }
    });
  }, [showSidebar, tabs.length]);

  const handleAgentRunningChange = (running: boolean) => {
    setAgentRunning(running);
    if (running) {
      const now = Date.now();
      setAgentStartedAt(now);
      setAgentElapsedMs(0);
    } else {
      setAgentStartedAt(null);
      setAgentStepText(null);
      setAgentTabId(null);
      refreshState();
    }
  };

  useEffect(() => {
    if (!agentRunning || !agentStartedAt) return;
    const timer = setInterval(() => {
      setAgentElapsedMs(Date.now() - agentStartedAt);
    }, 250);
    return () => clearInterval(timer);
  }, [agentRunning, agentStartedAt]);

  const isGoogleAuthUrl = useCallback((url: string) => {
    const u = url.toLowerCase();
    return u.includes('accounts.google.com') && (u.includes('signin') || u.includes('auth'));
  }, []);

  const isGoogleAuthRejectedUrl = useCallback((url: string) => {
    const u = url.toLowerCase();
    return u.includes('accounts.google.com') && u.includes('rejected');
  }, []);

  const openAuthExternally = useCallback((url: string) => {
    if (lastExternalAuthUrlRef.current === url) return;
    lastExternalAuthUrlRef.current = url;
    window.bronAPI?.openExternalUrl(url);
  }, []);

  const mirrorUrlToAgentBrowser = useCallback(async (url: string) => {
    if (UNIFIED_AGENT_MODE) return;
    if (!window.bronAPI || agentRunning || url === lastMirroredUrlRef.current) return;
    if (url.startsWith('about:')) return;
    
    try {
      lastMirroredUrlRef.current = url;
      await window.bronAPI.navigate(url);
      setControllerHealthy(true);
    } catch {
      setControllerHealthy(false);
    }
  }, [agentRunning]);

  const updateTabUrlLocally = useCallback((tabId: string, url: string) => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === tabId);
      if (!tab) return prev;
      
      // Ignore minor flutters (trailing slash or common auth/tracking query params)
      const normalize = (u: string) => u.replace(/\/$/, '').split('?')[0];
      if (normalize(tab.url) === normalize(url)) {
         // If base URL is the same, only update if the query params are significantly different or it's a long-lived change
         if (tab.url.length > url.length && tab.url.includes(url)) return prev;
         if (url.length > tab.url.length && url.includes(tab.url)) return prev;
      }

      return prev.map(t => t.id === tabId ? { ...t, url, title: buildTabTitle(url) } : t);
    });
  }, []);

  const buildTabTitle = (url: string) => {
    try {
      const hostname = new URL(url).hostname;
      const title = hostname.replace('www.', '');
      // Track history
      if (window.bronAPI && !url.startsWith('about:')) {
        window.bronAPI.addHistoryEntry(url, title).catch(() => {});
      }
      return title;
    } catch {
      return url;
    }
  };

  const formatDuration = useCallback((ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    if (minutes <= 0) return `${seconds}s`;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }, []);

  const setupWebviewListeners = useCallback((tabId: string, wv: ElectronWebview) => {
    const handleNavigation = () => {
      const url = wv.getURL();
      updateTabUrlLocally(tabId, url);
      
      const tab = tabs.find(t => t.id === tabId);
      if (tab?.active) {
        if (isGoogleAuthRejectedUrl(url)) {
          // setAuthNotice('Google sign-in is blocked in embedded mode. Continue the sign-in in your default browser.');
          // openAuthExternally(url);
          console.warn('Google sign-in rejection detected, but continuing in-app due to stealth fixes.');
        } else if (!isGoogleAuthUrl(url)) {
          setAuthNotice(null);
          lastExternalAuthUrlRef.current = '';
        }

        if (!UNIFIED_AGENT_MODE) {
          // Use a small delay for mirroring to avoid noise during rapid navigation
          setTimeout(() => {
             const latest = webviewRefs.current.get(tabId)?.getURL();
             if (latest === url) mirrorUrlToAgentBrowser(url);
          }, 300);
        }
      }
    };

    const handleLoadStart = () => {
      const active = tabs.find(t => t.active);
      if (active?.id === tabId) setIsLoading(true);
    };
    
    const handleLoadStop = () => {
      setIsLoading(false);
      handleNavigation();
    };

    const handleNewWindow = (e: any) => {
      if (typeof e?.preventDefault === 'function') e.preventDefault();
      const url = e.url;
      if (url) handleNewTab(url);
    };

    const handleDomReady = () => {
      try {
        wv.setZoomFactor(showSidebar ? 0.85 : 1.0);
      } catch (e) { }
    };

    wv.addEventListener('did-start-loading', handleLoadStart);
    wv.addEventListener('did-stop-loading', handleLoadStop);
    wv.addEventListener('did-navigate', handleNavigation);
    wv.addEventListener('did-navigate-in-page', handleNavigation);
    wv.addEventListener('new-window', handleNewWindow);
    wv.addEventListener('dom-ready', handleDomReady);

    return () => {
      wv.removeEventListener('did-start-loading', handleLoadStart);
      wv.removeEventListener('did-stop-loading', handleLoadStop);
      wv.removeEventListener('did-navigate', handleNavigation);
      wv.removeEventListener('did-navigate-in-page', handleNavigation);
      wv.removeEventListener('new-window', handleNewWindow);
    };
  }, [tabs, agentRunning, isGoogleAuthRejectedUrl, isGoogleAuthUrl, mirrorUrlToAgentBrowser, openAuthExternally, updateTabUrlLocally]);

  const handleNavigate = (url: string) => {
    let target = url.trim();
    if (!/^https?:\/\//i.test(target) && !target.startsWith('about:')) {
      if (target.includes('.') && !target.includes(' ')) {
        target = 'https://' + target;
      } else {
        target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
      }
    }
    
    const wv = webviewRefs.current.get(activeTab.id);
    if (wv) wv.loadURL(target);
    updateTabUrlLocally(activeTab.id, target);
    
    if (!UNIFIED_AGENT_MODE && !agentRunning) mirrorUrlToAgentBrowser(target);
  };

  const handleBack = async () => {
    const wv = webviewRefs.current.get(activeTab.id);
    if (wv && wv.canGoBack()) wv.goBack();
    if (!UNIFIED_AGENT_MODE) {
      await window.bronAPI?.goBack().catch(() => setControllerHealthy(false));
    }
  };

  const handleForward = async () => {
    const wv = webviewRefs.current.get(activeTab.id);
    if (wv && wv.canGoForward()) wv.goForward();
    if (!UNIFIED_AGENT_MODE) {
      await window.bronAPI?.goForward().catch(() => setControllerHealthy(false));
    }
  };

  const handleRefresh = async () => {
    const wv = webviewRefs.current.get(activeTab.id);
    if (wv) wv.reload();
    if (!UNIFIED_AGENT_MODE) {
      await window.bronAPI?.refresh().catch(() => setControllerHealthy(false));
    }
  };

  const handleNewTab = async (initialUrl?: string): Promise<string | undefined> => {
    if (syncLockRef.current) return;
    syncLockRef.current = true;

    const nextUrl = (typeof initialUrl === 'string' && initialUrl) ? initialUrl : 'https://www.google.com/';
    const newId = `local_tab_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // Optimistic local update
    setTabs(prev => {
      const updated = prev.map(t => ({ ...t, active: false }));
      return [...updated, { id: newId, title: buildTabTitle(nextUrl), url: nextUrl, active: true, initialUrl: nextUrl }];
    });
    
    if (UNIFIED_AGENT_MODE) {
      syncLockRef.current = false;
      return newId;
    }

    try {
      const realId = await window.bronAPI?.newTab(nextUrl);
      setControllerHealthy(true);

      if (typeof realId === 'string' && realId) {
        setTabs(prev => prev.map(t => (t.id === newId ? { ...t, id: realId } : t)));
        return realId;
      } else {
        await refreshState();
      }
      return newId;
    } catch {
      setControllerHealthy(false);
      return undefined;
    } finally {
      syncLockRef.current = false;
    }
  };

  const handleCloseTab = async (tabId: string) => {
    if (tabs.length <= 1) return;
    
    const remaining = tabs.filter(t => t.id !== tabId);
    if (!remaining.some(t => t.active)) {
      remaining[remaining.length - 1].active = true;
    }
    setTabs(remaining);
    const cleanup = webviewCleanupRefs.current.get(tabId);
    if (cleanup) cleanup();
    webviewCleanupRefs.current.delete(tabId);
    webviewRefs.current.delete(tabId);

    if (!UNIFIED_AGENT_MODE) {
      await window.bronAPI?.closeTab(tabId).catch(() => setControllerHealthy(false));
      refreshState();
    }
  };

  const handleSwitchTab = async (tabId: string) => {
    if (tabId === activeTab.id) return;
    
    // Optimistic local update
    setTabs(prev => prev.map(t => ({ ...t, active: t.id === tabId })));
    
    try {
      if (!UNIFIED_AGENT_MODE) {
        await window.bronAPI?.switchTab(tabId);
      }
      // Immediately sync the URL of the tab we just switched to
      const targetUrl = webviewRefs.current.get(tabId)?.getURL();
      if (targetUrl && !UNIFIED_AGENT_MODE) mirrorUrlToAgentBrowser(targetUrl);
    } catch {
      setControllerHealthy(false);
    }
  };

  const handleZoomIn = () => {
    const wv = webviewRefs.current.get(activeTab.id);
    if (wv) {
      try {
        const current = wv.getZoomFactor();
        wv.setZoomFactor(current + 0.1);
      } catch (e) { }
    }
  };

  const handleZoomOut = () => {
    const wv = webviewRefs.current.get(activeTab.id);
    if (wv) {
      try {
        const current = wv.getZoomFactor();
        wv.setZoomFactor(Math.max(0.1, current - 0.1));
      } catch (e) { }
    }
  };
 
  const handleSwitchProfile = async (profileName: string) => {
    if (!settings || !window.bronAPI) return;
    const next = { ...settings, browserProfile: profileName };
    try {
      setIsLoading(true);
      await window.bronAPI.saveSettings(next);
      setSettings(next);
      // Main process restarts the context; we should refresh tabs after a bit
      setTimeout(() => refreshState(), 1500);
    } catch (err) {
      console.error('Failed to switch profile:', err);
    } finally {
      setIsLoading(false);
    }
  };
 
  const getBridgeTargetTabId = useCallback((requestedTabId?: string | null) => {
    if (requestedTabId && tabs.some((t) => t.id === requestedTabId)) {
      return requestedTabId;
    }
    const pinned = bridgeAgentTabIdRef.current;
    if (pinned && tabs.some((t) => t.id === pinned)) {
      return pinned;
    }
    return activeTab?.id || tabs[0]?.id || null;
  }, [tabs, activeTab]);

  const withBridgeWebview = useCallback(async <T,>(
    requestedTabId: string | null | undefined,
    fn: (tabId: string, webview: ElectronWebview) => Promise<T>,
  ): Promise<T> => {
    const tabId = getBridgeTargetTabId(requestedTabId);
    if (!tabId) throw new Error('No active tab available');
    const webview = webviewRefs.current.get(tabId);
    if (!webview) throw new Error(`Tab ${tabId} is not ready`);
    if (!document.contains(webview)) throw new Error(`Tab ${tabId} webview is no longer in DOM`);
    
    try {
      return await fn(tabId, webview);
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error(`Bridge action failed on tab ${tabId}:`, msg);
      // If it's a "Script failed to execute" error, it often means the guest is busy or crashed
      if (msg.includes('Script failed to execute') || msg.includes('GUEST_VIEW_MANAGER_CALL')) {
        throw new Error(`Webview is unresponsive or crashed on tab ${tabId}: ${msg}`);
      }
      throw err;
    }
  }, [getBridgeTargetTabId]);

  useEffect(() => {
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const waitForWebviewSettle = async (
      webview: ElectronWebview,
      mode: 'navigation' | 'action' = 'action',
    ) => {
      const timeoutMs = mode === 'navigation' ? 3000 : 800;
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          webview.removeEventListener('did-stop-loading', onStopLoading as any);
          webview.removeEventListener('did-fail-load', onStopLoading as any);
          resolve();
        };
        const onStopLoading = () => finish();
        const timer = setTimeout(() => {
          clearTimeout(timer);
          finish();
        }, timeoutMs);
        webview.addEventListener('did-stop-loading', onStopLoading as any);
        webview.addEventListener('did-fail-load', onStopLoading as any);
      });
      await delay(mode === 'navigation' ? 100 : 40);
    };

    const registerBridgeAction = (key: string) => {
      const now = Date.now();
      const prev = bridgeActionStatsRef.current.get(key);
      if (!prev || now - prev.lastAt > 12000) {
        bridgeActionStatsRef.current.set(key, { count: 1, lastAt: now });
        return 1;
      }
      const next = { count: prev.count + 1, lastAt: now };
      bridgeActionStatsRef.current.set(key, next);
      return next.count;
    };

    const shouldThrottleBridgeAction = (key: string, limit: number) => {
      const count = registerBridgeAction(key);
      return count > limit;
    };

    const autoHandleTransientUi = async (webview: ElectronWebview, selectorHint = ''): Promise<string | null> => {
      try {
        return await webview.executeJavaScript(
          '(function(){\n' +
          '  const isVisible = (el) => {\n' +
          '    if (!(el instanceof HTMLElement)) return false;\n' +
          '    const rect = el.getBoundingClientRect();\n' +
          '    if (rect.width < 4 || rect.height < 4) return false;\n' +
          '    const style = window.getComputedStyle(el);\n' +
          '    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";\n' +
          '  };\n' +
          '  const clickByPatterns = (root, patterns, riskyPatterns) => {\n' +
          '    const buttons = Array.from(root.querySelectorAll("button, [role=\\"button\\"], a"));\n' +
          '    for (const btn of buttons) {\n' +
          '      if (!isVisible(btn)) continue;\n' +
          '      const txt = (((btn.textContent || "") + " " + (btn.getAttribute("aria-label") || "")).trim()).toLowerCase();\n' +
          '      if (!txt) continue;\n' +
          '      if (riskyPatterns.some((p) => p.test(txt))) continue;\n' +
          '      if (patterns.some((p) => p.test(txt))) {\n' +
          '        btn.click();\n' +
          '        return txt.slice(0, 60);\n' +
          '      }\n' +
          '    }\n' +
          '    return null;\n' +
          '  };\n' +
          '  const host = location.hostname.toLowerCase();\n' +
          '  const hint = ' + JSON.stringify(selectorHint) + '.toLowerCase();\n' +
          '  const riskyPatterns = [/pay/, /purchase/, /place order/, /confirm$/, /delete$/];\n' +
          '  const dismissPatterns = [/not now/, /no thanks/, /skip/, /dismiss/, /close/, /later/, /cancel/, /x$/];\n' +
          '  const consentPatterns = [/accept all/, /^accept$/, /i agree/, /^ok$/, /got it/];\n' +
          '  const dialogs = Array.from(document.querySelectorAll(\'[role="dialog"], .modal, .popup, .consent, .cookie, .overlay\'))\n' +
          '    .filter(isVisible).slice(0, 4);\n' +
          '  if (location.hostname.includes("web.whatsapp.com") && document.querySelector("#initial_startup, ._1v_Wv")) return "WhatsApp loading...";\n' +
          '  for (const dialog of dialogs) {\n' +
          '    const text = (dialog.textContent || "").toLowerCase();\n' +
          '    if (/passkey|security key|windows security|webauthn|verify it\\\'?s you|use your device/.test(text)) {\n' +
          '      const cancelled = clickByPatterns(dialog, [/cancel/, /close/, /not now/, /dismiss/, /x$/], riskyPatterns);\n' +
          '      if (cancelled) return "handled popup: " + cancelled;\n' +
          '      continue;\n' +
          '    }\n' +
          '    if (host.includes("linkedin.com")) {\n' +
          '      const withoutNote = clickByPatterns(dialog, [/send without/, /without a note/, /^send$/], riskyPatterns);\n' +
          '      if ((hint.includes("connect") || hint.includes("invite") || /connect|invite|add a note|personalize/.test(text)) && withoutNote) return "LinkedIn invite flow handled";\n' +
          '      if (/sign in|join linkedin|log in/.test(text) && !hint.includes("login")) {\n' +
          '        const dismissed = clickByPatterns(dialog, [/dismiss/, /close/, /not now/, /cancel/, /x$/], riskyPatterns);\n' +
          '        if (dismissed) return "LinkedIn login modal dismissed";\n' +
          '      }\n' +
          '    }\n' +
          '    const dismissed = clickByPatterns(dialog, dismissPatterns, riskyPatterns);\n' +
          '    if (dismissed) return "handled popup: " + dismissed;\n' +
          '    if (/cookie|consent|privacy|gdpr|tracking|ads/.test(text)) {\n' +
          '      const accepted = clickByPatterns(dialog, consentPatterns, riskyPatterns);\n' +
          '      if (accepted) return "handled popup: " + accepted;\n' +
          '    }\n' +
          '  }\n' +
          '  return null;\n' +
          '})();'
        );
      } catch {
        return null;
      }
    };

    (window as any).__bronBridgeExecute = async (rawReq: any) => {
      let req = rawReq;
      if (typeof req === 'string') {
        try { req = JSON.parse(req); } catch(e) { console.error('Bridge parse error:', e); return null; }
      }
      const method = String(req?.method || '');
      const payload = req?.payload || {};

      switch (method) {
        case 'getActiveTabId':
          return getBridgeTargetTabId(payload?.tabId || null);
        case 'setAgentTabId':
          bridgeAgentTabIdRef.current = payload?.tabId ? String(payload.tabId) : null;
          return true;
        case 'getTabs':
          return tabs;
        case 'newTab': {
          const createdId = await handleNewTab(payload?.url ? String(payload.url) : undefined);
          return createdId || '';
        }
        case 'switchTab': {
          const tabId = String(payload?.tabId || '');
          if (!tabId) return false;
          await handleSwitchTab(tabId);
          return true;
        }
        case 'closeTab': {
          const tabId = String(payload?.tabId || '');
          if (!tabId) return false;
          await handleCloseTab(tabId);
          return true;
        }
        case 'navigate':
          await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            let target = String(payload?.url || '').trim();
            if (!/^https?:\/\//i.test(target) && !target.startsWith('about:')) {
              if (target.includes('.') && !target.includes(' ')) target = `https://${target}`;
              else target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
            }
            await webview.loadURL(target);
            await waitForWebviewSettle(webview, 'navigation');
            await autoHandleTransientUi(webview, target);
            return true;
          });
          return true;
        case 'click':
          return await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            const selector = String(payload?.selector || '');
            const isRightClick = !!payload?.rightClick;
            console.log(`Executing ${isRightClick ? 'right' : 'left'} click on ${selector}`);
            const res = await webview.executeJavaScript(
              '(function(){\n' +
              '  const sel = ' + JSON.stringify(selector) + ';\n' +
              '  const isRight = ' + isRightClick + ';\n' +
              '  try {\n' +
              '    const findByText = (regex) => {\n' +
              '      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);\n' +
              '      let node; const matches = [];\n' +
              '      while(node = walker.nextNode()) {\n' +
              '        if (regex.test(node.textContent)) {\n' +
              '          const p = node.parentElement;\n' +
              '          if (p && p.tagName !== "SCRIPT" && p.tagName !== "STYLE") matches.push(p);\n' +
              '        }\n' +
              '      }\n' +
              '      return matches[0];\n' +
              '    };\n' +
              '    const tryDirect = () => {\n' +
              '      try { return document.querySelector(sel); } catch(e) { return null; }\n' +
              '    };\n' +
              '    const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\\\\\\\\\\\\]\\\\\\\\\\\\]/g, "\\\\\\\\$&");\n' +
              '    let el = tryDirect();\n' +
              '    if (!el) {\n' +
              '      const hasTextMatch = sel.match(/:has-text\\\\\\\\(([\'"])(.*?)\\\\\\\\1\\\\\\\\)/i);\n' +
              '      if (hasTextMatch?.[2]) {\n' +
              '        const needle = hasTextMatch[2].toLowerCase().trim();\n' +
              '        el = findByText(new RegExp(escapeRegExp(needle)));\n' +
              '      }\n' +
              '    }\n' +
              '    if (!el) {\n' +
              '      const containsMatch = sel.match(/:contains\\\\\\\\(([\'"])(.*?)\\\\\\\\1\\\\\\\\)/i);\n' +
              '      if (containsMatch?.[2]) {\n' +
              '        const needle = containsMatch[2].toLowerCase().trim();\n' +
              '        el = findByText(new RegExp(escapeRegExp(needle)));\n' +
              '      }\n' +
              '    }\n' +
              '    if (!el && sel.startsWith("text=")) {\n' +
              '      const raw = sel.slice(5).replace(/^[\\\'"]|[\\\'"]$/g, "").trim().toLowerCase();\n' +
              '      if (raw) el = findByText(new RegExp(escapeRegExp(raw)));\n' +
              '    }\n' +
              '    if (!el) return { error: "Click failed: element not found" };\n' +
              '    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });\n' +
              '    const rect = el.getBoundingClientRect();\n' +
              '    const x = Math.round(rect.left + rect.width/2); \n' +
              '    const y = Math.round(rect.top + rect.height/2);\n' +
              '    if (isRight) {\n' +
              '      const opts = { bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, clientX: x, clientY: y };\n' +
              '      el.dispatchEvent(new MouseEvent("contextmenu", opts));\n' +
              '      return { success: true, method: "right-click", x, y };\n' +
              '    } else {\n' +
              '      const opts = { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y };\n' +
              '      el.dispatchEvent(new MouseEvent("mousedown", opts));\n' +
              '      el.dispatchEvent(new MouseEvent("mouseup", opts));\n' +
              '      el.click();\n' +
              '      return { success: true, method: "click", x, y };\n' +
              '    }\n' +
              '  } catch (e) { return { error: e.message }; }\n' +
              '})();'
            );
            if (res.error) return `Click failed: ${res.error}`;
            await waitForWebviewSettle(webview, 'action');
            await autoHandleTransientUi(webview, selector);
            return res;
          });
        case 'hover':
          return await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            const selector = String(payload?.selector || '');
            const res = await webview.executeJavaScript(
              '(function(){\n' +
              '  const sel = ' + JSON.stringify(selector) + ';\n' +
              '  try {\n' +
              '    let el = document.querySelector(sel);\n' +
              '    if (!el) return { error: "element not found" };\n' +
              '    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });\n' +
              '    const rect = el.getBoundingClientRect();\n' +
              '    const x = Math.round(rect.left + rect.width/2); \n' +
              '    const y = Math.round(rect.top + rect.height/2);\n' +
              '    const ev = new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y });\n' +
              '    el.dispatchEvent(ev);\n' +
              '    return { success: true, x, y };\n' +
              '  } catch (e) { return { error: e.message }; }\n' +
              '})();'
            );
            return res;
          });
        case 'goBack':
          await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            if (webview.canGoBack()) {
              webview.goBack();
              await waitForWebviewSettle(webview, 'navigation');
            }
            return true;
          });
          return true;
        case 'goForward':
          await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            if (webview.canGoForward()) {
              webview.goForward();
              await waitForWebviewSettle(webview, 'navigation');
            }
            return true;
          });
          return true;
        case 'refresh':
          await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            webview.reload();
            await waitForWebviewSettle(webview, 'navigation');
            await autoHandleTransientUi(webview, 'refresh');
            return true;
          });
          return true;
        case 'search':
          await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            const query = String(payload?.query || '');
            await webview.loadURL(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
            await waitForWebviewSettle(webview, 'navigation');
            await autoHandleTransientUi(webview, query);
            return true;
          });
          return true;
        case 'selectOption':
          return await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            const selector = String(payload?.selector || '');
            const value = String(payload?.value || '');
            if (!selector) return 'Select failed: empty selector';
            const result = await webview.executeJavaScript(
              '(function(){\n' +
              '  try {\n' +
              '    const sel = ' + JSON.stringify(selector) + ';\n' +
              '    const val = ' + JSON.stringify(value) + ';\n' +
              '    const el = document.querySelector(sel);\n' +
              '    if (!el) return "Select failed: element not found";\n' +
              '    if (!(el instanceof HTMLSelectElement)) return "Select failed: target is not <select>";\n' +
              '    el.value = val;\n' +
              '    el.dispatchEvent(new Event("change", { bubbles: true }));\n' +
              '    return "Selected \\"" + val + "\\" in " + sel;\n' +
              '  } catch (e) { return "Select error: " + e.message; }\n' +
              '})();'
            );
            await waitForWebviewSettle(webview, 'action');
            return result;
          });
        case 'typeText':
          return await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            const selector = String(payload?.selector || '');
            const value = String(payload?.value || '');
            if (!selector) return 'Type failed: empty selector';
            const throttleKey = `type:${selector.toLowerCase().slice(0, 100)}:${value.toLowerCase().slice(0, 80)}`;
            if (shouldThrottleBridgeAction(throttleKey, 3)) {
              return `Type skipped: repeated value throttled for ${selector}`;
            }
            const result = await webview.executeJavaScript(
              '(function(){\n' +
              '  try {\n' +
              '    const sel = ' + JSON.stringify(selector) + ';\n' +
              '    const val = ' + JSON.stringify(value) + ';\n' +
              '    let el;\n' +
              '    try { el = document.querySelector(sel); } catch(e) {}\n' +
              '    if (!el) return { error: "Type failed: element not found" };\n' +
              '    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });\n' +
              '    el.focus();\n' +
              '    const rect = el.getBoundingClientRect();\n' +
              '    const x = Math.round(rect.left + rect.width / 2);\n' +
              '    const y = Math.round(rect.top + rect.height / 2);\n' +
              '    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {\n' +
              '      el.value = val;\n' +
              '      el.dispatchEvent(new Event("input", { bubbles: true }));\n' +
              '      el.dispatchEvent(new Event("change", { bubbles: true }));\n' +
              '      return { success: true, method: "type-input", x, y };\n' +
              '    }\n' +
              '    if (el instanceof HTMLElement && el.isContentEditable) {\n' +
              '      try {\n' +
              '        document.execCommand("selectAll", false, null);\n' +
              '        document.execCommand("insertText", false, val);\n' +
              '      } catch(e) { el.textContent = val; }\n' +
              '      el.dispatchEvent(new Event("input", { bubbles: true }));\n' +
              '      return { success: true, method: "type-editable", x, y };\n' +
              '    }\n' +
              '    return { error: "target is not editable" };\n' +
              '  } catch (e) { return { error: e.message }; }\n' +
              '})();'
            );
            if (result.error) return `Type failed: ${result.error}`;
            await waitForWebviewSettle(webview, 'action');
            return result;
          });
        case 'pressEnter':
          return await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            const result = await webview.executeJavaScript(
              '(function(){\n' +
              '  let active = document.activeElement;\n' +
                
'  if (!active || active === document.body || active === document.documentElement) {\n' +
'    const likely = Array.from(document.querySelectorAll("input[type=\\"text\\"], input[type=\\"search\\"], textarea, [role=\\"combobox\\"], [role=\\"searchbox\\"]"))\n' +
'      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && window.getComputedStyle(el).display !== "none"; });\n' +
'    if (likely.length > 0) { active = likely[0]; active.focus(); }\n' +
'  }\n' +

'  if (!active) return "Pressed Enter (no active element found)";\n' +

'  const options = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };\n' +
'  active.dispatchEvent(new KeyboardEvent("keydown", options));\n' +
'  active.dispatchEvent(new KeyboardEvent("keypress", options));\n' +
'  active.dispatchEvent(new KeyboardEvent("keyup", options));\n' +

'  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {\n' +
'     if (active.form) { try { active.form.requestSubmit(); } catch(e) { active.form.submit(); } }\n' +
'  } else if (active instanceof HTMLFormElement) {\n' +
'     try { active.requestSubmit(); } catch(e) { active.submit(); }\n' +
'  }\n' +
'  return "Pressed Enter";\n' +
'})();'
            );
            await waitForWebviewSettle(webview, 'navigation');
            await new Promise(r => setTimeout(r, 400)); // Extra settle for search results
            const note = await autoHandleTransientUi(webview, 'enter');
            return note ? `${result} (${note})` : result;
          });
         case 'pressKey':
          return await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            const key = String(payload?.key || 'Tab');
            const result = await webview.executeJavaScript(
              '(function(){\n' +
              '  const active = document.activeElement || document.body;\n' +
              '  const key = ' + JSON.stringify(key) + ';\n' +
              '  const options = { key, code: key, bubbles: true, cancelable: true };\n' +
              '  active.dispatchEvent(new KeyboardEvent("keydown", options));\n' +
              '  active.dispatchEvent(new KeyboardEvent("keyup", options));\n' +
              '  return "Pressed " + key;\n' +
              '})();'
            );
            await waitForWebviewSettle(webview, 'action');
            return result;
          });
        case 'scroll':
          return await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            const direction = String(payload?.direction || 'down').toLowerCase();
            const delta = direction === 'up' ? -500 : 500;
            const throttleKey = `scroll:${direction}`;
            if (shouldThrottleBridgeAction(throttleKey, 16)) {
              const autoPaginate = await webview.executeJavaScript(
                '(function(){\n' +
                '  const next = document.querySelector("[data-testid=\'pagination-controls-next-button-visible\'], button[aria-label*=\'Next\' i], a[aria-label*=\'Next\' i]");\n' +
                '  if (next instanceof HTMLElement) { next.click(); return "Scrolled too much, clicked next page"; }\n' +
                '  return "Scroll skipped: throttled";\n' +
                '})();'
              );
              await waitForWebviewSettle(webview, 'navigation');
              return autoPaginate;
            }
            await webview.executeJavaScript('window.scrollBy({ top: ' + delta + ', behavior: "instant" });');
            await waitForWebviewSettle(webview, 'action');
            return `Scrolled ${direction === 'up' ? 'up' : 'down'}`;
          });
        case 'highlightElement':
          await withBridgeWebview(payload?.tabId, async (_tabId, webview) => {
            const selector = String(payload?.selector || '');
            if (!selector) return true;
            await webview.executeJavaScript(
              '(function(){\n' +
              '  const sel = ' + JSON.stringify(selector) + ';\n' +
              '  const el = document.querySelector(sel);\n' +
              '  if (!el) return;\n' +
              '  const rect = el.getBoundingClientRect();\n' +
              '  const h = document.createElement("div");\n' +
              '  h.id = "bron-bridge-highlight";\n' +
              '  Object.assign(h.style, {\n' +
              '    position: "fixed",\n' +
              '    top: (rect.top - 3) + "px",\n' +
              '    left: (rect.left - 3) + "px",\n' +
              '    width: (rect.width + 6) + "px",\n' +
              '    height: (rect.height + 6) + "px",\n' +
              '    border: "2px solid #3b82f6",\n' +
              '    borderRadius: "8px",\n' +
              '    boxShadow: "0 0 0 2px rgba(59,130,246,0.2)",\n' +
              '    zIndex: "2147483647",\n' +
              '    pointerEvents: "none"\n' +
              '  });\n' +
              '  const old = document.getElementById("bron-bridge-highlight"); if(old) old.remove();\n' +
              '  document.body.appendChild(h);\n' +
              '  setTimeout(() => h.remove(), 800);\n' +
              '})();'
            );
            return true;
          });
          return true;
        case 'getBrowserState':
          return await withBridgeWebview(payload?.tabId, async (tabId, webview) => {
            const page = await webview.executeJavaScript(
              ';(' + function() {
                try {
                  var isVisible = function(el) {
                    if (!(el instanceof HTMLElement)) return false;
                    var rect = el.getBoundingClientRect();
                    if (rect.width < 4 || rect.height < 4) return false;
                    var style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                  };
                  var text = ((document.body && document.body.innerText) || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 10000);
                  var clickable = [];
                  var seenPos = {};
                  var clickableEls = document.querySelectorAll('a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"]');
                  for (var i = 0; i < clickableEls.length; i++) {
                    if (clickable.length >= 100) break;
                    var el = clickableEls[i];
                    if (!isVisible(el)) continue;
                    var txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
                    var aria = el.getAttribute('aria-label');
                    var title = el.getAttribute('title');
                    if (!txt) txt = aria || title || '';
                    txt = txt.slice(0, 80);
                    var rect = el.getBoundingClientRect();
                    var cx = Math.round(rect.left + rect.width / 2);
                    var cy = Math.round(rect.top + rect.height / 2);
                    var posKey = cx + ',' + cy;
                    if (!txt && !aria && !title) continue;
                    if (seenPos[posKey]) continue;
                    seenPos[posKey] = true;
                    var tag = el.tagName.toLowerCase();
                    var role = el.getAttribute('role') || undefined;
                    var selector = '';
                    var id = el.getAttribute('id');
                    var testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
                    if (id) { try { selector = '#' + CSS.escape(id); } catch(e) { continue; } }
                    else if (testId) { selector = '[data-testid="' + testId.replace(/"/g, '\\"') + '"]'; }
                    else if (aria) { selector = tag + '[aria-label="' + aria.replace(/"/g, '\\"') + '"]'; }
                    else if (title) { selector = tag + '[title="' + title.replace(/"/g, '\\"') + '"]'; }
                    else { selector = tag; }
                    clickable.push({ text: txt, tag: tag, role: role, selector: selector, x: cx, y: cy });
                  }
                  var inputFields = [];
                  var inputEls = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"], [role="combobox"], [role="searchbox"], [role="textbox"]');
                  for (var j = 0; j < inputEls.length; j++) {
                    if (inputFields.length >= 20) break;
                    var inp = inputEls[j];
                    if (!isVisible(inp)) continue;
                    var iTag = inp.tagName.toLowerCase();
                    var iType = inp.type || inp.getAttribute('role') || iTag;
                    var placeholder = inp.placeholder || inp.getAttribute('aria-placeholder') || undefined;
                    var ariaLabel = inp.getAttribute('aria-label');
                    var iLabel = ariaLabel || undefined;
                    if (!iLabel && inp.id) { try { var lel = document.querySelector('label[for="' + CSS.escape(inp.id) + '"]'); if (lel) iLabel = (lel.textContent || '').trim().slice(0, 60); } catch(e) {} }
                    var iSel = '';
                    var iTestId = inp.getAttribute('data-testid') || inp.getAttribute('data-test-id');
                    if (inp.id) { try { iSel = '#' + CSS.escape(inp.id); } catch(e) { continue; } }
                    else if (iTestId) { iSel = '[data-testid="' + iTestId.replace(/"/g, '\\"') + '"]'; }
                    else if (inp.name) { iSel = iTag + '[name="' + inp.name.replace(/"/g, '\\"') + '"]'; }
                    else if (ariaLabel) { iSel = '[aria-label="' + ariaLabel.replace(/"/g, '\\"') + '"]'; }
                    else if (placeholder) { iSel = '[placeholder="' + placeholder.replace(/"/g, '\\"') + '"]'; }
                    else continue;
                    inputFields.push({ placeholder: placeholder, label: iLabel, type: iType, selector: iSel });
                  }
                  return { url: location.href, title: document.title || '', visibleText: text, clickableElements: clickable, inputFields: inputFields, scrollX: window.scrollX || 0, scrollY: window.scrollY || 0 };
                } catch(e) { return { url: location.href, title: document.title || '', visibleText: 'Extraction error: ' + e.message, clickableElements: [], inputFields: [], scrollX: 0, scrollY: 0 }; }
              }.toString() + ')()'
            );

            const screenshot = await webview.capturePage().then(img => img.toDataURL('image/jpeg', 80)).catch(() => undefined);

            return {
              ...page,
              tabs: tabs.map(t => t.id === tabId ? { ...t, webContentsId: webview.getWebContentsId() } : t),
              url: page?.url || webview.getURL() || '',
              title: page?.title || tabs.find((t) => t.id === tabId)?.title || '',
              screenshot,
            };
          });
        default:
          throw new Error(`Unknown bridge method: ${method}`);
      }
    };

    return () => {
      if ((window as any).__bronBridgeExecute) {
        delete (window as any).__bronBridgeExecute;
      }
    };
  }, [
    tabs,
    activeTab,
    getBridgeTargetTabId,
    withBridgeWebview,
    handleNewTab,
    handleSwitchTab,
    handleCloseTab,
  ]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-bron-bg font-sans selection:bg-bron-accent/30 text-bron-text">
      <BrowserToolbar
        url={currentUrl}
        tabs={tabs}
        onNavigate={handleNavigate}
        onBack={handleBack}
        onForward={handleForward}
        onRefresh={handleRefresh}
        onNewTab={handleNewTab}
        onSwitchTab={handleSwitchTab}
        onCloseTab={handleCloseTab}
        onToggleSidebar={() => setShowSidebar(!showSidebar)}
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
        currentTheme={theme}
        onSwitchTheme={setTheme}
        onAbout={() => alert('Bron Agentic Browser v2.0\nBuilt by Abdallah Dalvi\n\nA powerful autonomous research tool.')}
      />

      <div className="flex-1 flex overflow-hidden min-w-0">
        <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 relative min-w-0 ${agentRunning ? 'aura-active' : ''}`}>
          <div className="flex-1 relative bg-bron-bg overflow-hidden shadow-2xl">
            <div className="aura-container" />
            
            {/* Multi-Tab Webview Container */}
            {browserReady ? (
              <div className="w-full h-full relative">
                {tabs.map((tab) => (
                  <webview
                    key={tab.id}
                    ref={(el) => {
                      const existingCleanup = webviewCleanupRefs.current.get(tab.id);

                      if (!el) {
                        if (existingCleanup) {
                          existingCleanup();
                          webviewCleanupRefs.current.delete(tab.id);
                        }
                        webviewRefs.current.delete(tab.id);
                        return;
                      }

                      if (el) {
                        const current = webviewRefs.current.get(tab.id);
                        if (current !== (el as ElectronWebview)) {
                          if (existingCleanup) {
                            existingCleanup();
                          }
                          const cleanup = setupWebviewListeners(tab.id, el as ElectronWebview);
                          webviewCleanupRefs.current.set(tab.id, cleanup);
                        }
                        webviewRefs.current.set(tab.id, el as ElectronWebview);
                      }
                    }}
                    className="absolute inset-0 w-full h-full"
                    src={tab.initialUrl || tab.url}
                    partition="persist:bron-session"
                    allowpopups
                    style={{ 
                      visibility: tab.active ? 'visible' : 'hidden',
                      opacity: tab.active ? 1 : 0,
                      pointerEvents: tab.active ? 'auto' : 'none',
                      zIndex: tab.active ? 10 : 1
                    }}
                  />
                ))}

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

                {authNotice && (
                  <div className="absolute top-16 left-4 right-4 z-50 animate-slide-up">
                    <div className="flex items-center justify-between gap-4 p-5 rounded-[2rem] bg-amber-500 text-white shadow-2xl border border-white/20 backdrop-blur-xl">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                          <AlertCircle className="w-6 h-6" />
                        </div>
                        <p className="text-sm font-bold leading-relaxed max-w-xl">{authNotice}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openAuthExternally(currentUrl)}
                          className="px-6 py-2.5 rounded-2xl bg-white text-amber-600 text-xs font-black uppercase tracking-widest hover:bg-amber-50 transition-all shadow-xl active:scale-95"
                        >
                          Unlock in Browser
                        </button>
                        <button
                          onClick={() => setAuthNotice(null)}
                          className="w-10 h-10 rounded-2xl bg-black/20 hover:bg-black/30 transition-all flex items-center justify-center"
                        >
                          <X className="w-5 h-5" />
                        </button>
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

        {showSidebar && (
          <AgentSidebar
            agentRunning={agentRunning}
            setAgentRunning={handleAgentRunningChange}
            onOpenMemory={() => setShowMemory(true)}
            onOpenHistory={() => setShowChatHistory(true)}
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
            if (session) {
              window.dispatchEvent(
                new CustomEvent(LOAD_SESSION_EVENT, {
                  detail: { messages: session.messages, sessionId },
                }),
              );
              setShowMemory(false);
              setShowSidebar(true);
            }
          }}
        />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showChatHistory && (
        <ChatHistory
          onClose={() => setShowChatHistory(false)}
          onLoadSession={(messages: ChatMessage[], sessionId: number) => {
            window.dispatchEvent(
              new CustomEvent(LOAD_SESSION_EVENT, {
                detail: { messages, sessionId },
              }),
            );
            setShowChatHistory(false);
            setShowSidebar(true);
          } }
        />
      )}
      {showHistory && (
        <HistoryPanel
          onClose={() => setShowHistory(false)}
          onNavigate={handleNavigate}
        />
      )}
    </div>
  );
}

