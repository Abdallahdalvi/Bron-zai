import { app, BrowserWindow, Menu, session, shell, ipcMain, clipboard, nativeTheme, webContents } from 'electron';
import fs from 'fs';
import path from 'path';
import { IPC } from '../shared/types';
import { initDatabase, getSettings } from './memory';
import { setupIPC, parseDomainProfileMap } from './ipc';
import { BrowserController } from './browserController';
import { RendererAutomationController } from './automationController';

let mainWindow: BrowserWindow | null = null;
let browserController: BrowserController | null = null;
let cookieSyncTimer: NodeJS.Timeout | null = null;
let cookieSyncInFlight = false;
let rendererAutomationController: RendererAutomationController | null = null;

const isDev = !app.isPackaged;
const UNIFIED_AGENT_MODE = true;

app.commandLine.appendSwitch(
  'disable-features',
  'WebAuthentication,WebAuthenticationUI,FedCm,CredentialManagement',
);

const TRACKER_HOST_BLOCKLIST = new Set([
  'doubleclick.net',
  'adservice.google.co.in',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'facebook.net',
  'connect.facebook.net',
  'ads.twitter.com',
  'static.ads-twitter.com',
  'amazon-adsystem.com',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'scorecardresearch.com',
  'zedo.com',
  'criteo.com',
  'branch.io',
  'hotjar.com',
  'mixpanel.com',
  'segment.com',
  'quantserve.com',
  'pixel.advertising.com',
  'advertising.com',
  'yieldmo.com',
  'moatads.com',
  'rubiconproject.com',
  'openx.net',
  'pubmatic.com',
  'casalemedia.com',
  'adnxs-simple.com',
  'smartadserver.com',
  'adform.net',
  '360yield.com',
]);

const DENIED_PERMISSIONS = new Set([
  // Keep only high-risk ones or empty to allow most
  'openExternal',
]);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function configureEmbeddedBrowserSecurity(): void {
  app.on('web-contents-created', (_event, contents) => {
    // Apply current theme color-scheme on every page load
    contents.on('did-finish-load', () => {
      const isDark = nativeTheme.themeSource === 'dark';
      const scheme = isDark ? 'dark' : 'light';
      contents.insertCSS(`:root { color-scheme: ${scheme} !important; }`).catch(() => {});
    });

    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Avoid deleting preload if possible, or set to undefined
      if ((webPreferences as any).preload) {
        delete (webPreferences as any).preload;
      }
      
      (webPreferences as Record<string, unknown>).nodeIntegration = false;
      (webPreferences as Record<string, unknown>).contextIsolation = true;
      (webPreferences as Record<string, unknown>).userAgent = USER_AGENT;
      
      // Sandbox can cause ERR_ABORTED in some Electron versions if host is not sandboxed
      // (webPreferences as Record<string, unknown>).sandbox = true;
      
      (webPreferences as Record<string, unknown>).allowRunningInsecureContent = false;
      (webPreferences as Record<string, unknown>).webSecurity = true;
      (webPreferences as Record<string, unknown>).disableBlinkFeatures = 'WebAuthentication,CredentialManagement';

      const src = String(params.src || '');
      if (src && !/^https?:\/\//i.test(src) && src !== 'about:blank') {
        console.warn(`Blocking webview attachment to suspicious src: ${src}`);
        event.preventDefault();
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      // Always allow popups to trigger 'new-window' in the renderer
      if (contents.getType() === 'webview') {
        return { action: 'deny' }; 
      }
      
      // Fallback for non-webview windows
      if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });
  });

}

function configureSessionPolicies(): void {
  const sessions = [
    session.defaultSession,
    session.fromPartition('persist:bron-session')
  ];

  sessions.forEach(ses => {
    ses.setPermissionCheckHandler((_wc, permission) => {
      if (DENIED_PERMISSIONS.has(permission)) return false;
      return true;
    });

    ses.setPermissionRequestHandler((wc, permission, callback) => {
      const url = wc.getURL();
      const isGoogle = url.includes('google.com') || url.includes('google.co.in') || url.includes('google.co.uk');
      
      // Always allow storage access for Google
      if ((permission === 'storage-access' || permission === 'top-level-storage-access') && isGoogle) {
        callback(true);
        return;
      }

      // Allow camera, microphone, and geolocation by default as requested
      if (['media', 'geolocation', 'notifications', 'fullscreen'].includes(permission)) {
        callback(true);
        return;
      }

      if (DENIED_PERMISSIONS.has(permission)) {
        callback(false);
        return;
      }
      
      // Default allow for standard browser features
      callback(true);
    });

    ses.webRequest.onBeforeRequest((details, callback) => {
      try {
        if (details.resourceType === 'mainFrame') {
          callback({ cancel: false });
          return;
        }

        const parsed = new URL(details.url);
        const host = parsed.hostname.toLowerCase();
        const blockedByHost = Array.from(TRACKER_HOST_BLOCKLIST).some(
          (blocked) => host === blocked || host.endsWith(`.${blocked}`),
        );
        
        if (blockedByHost) {
          callback({ cancel: true });
          return;
        }
      } catch { }
      callback({ cancel: false });
    });
  });
}


function toPlaywrightSameSite(
  sameSite: string | undefined,
): 'Strict' | 'Lax' | 'None' | undefined {
  if (!sameSite) return undefined;
  const s = sameSite.toLowerCase();
  if (s === 'strict') return 'Strict';
  if (s === 'lax') return 'Lax';
  if (s === 'no_restriction') return 'None';
  return undefined;
}

function toElectronSameSite(sameSite: string | undefined): 'strict' | 'lax' | 'no_restriction' | 'unspecified' {
  if (!sameSite) return 'unspecified';
  const s = sameSite.toLowerCase();
  if (s === 'strict') return 'strict';
  if (s === 'lax') return 'lax';
  if (s === 'none') return 'no_restriction';
  return 'unspecified';
}

function buildCookieUrl(domain: string | undefined, secure: boolean, pathName: string | undefined): string | null {
  const raw = String(domain || '').trim();
  if (!raw) return null;
  const host = raw.replace(/^\./, '');
  if (!host) return null;
  const scheme = secure ? 'https' : 'http';
  const pathPart = pathName && pathName.startsWith('/') ? pathName : '/';
  return `${scheme}://${host}${pathPart}`;
}

async function syncCookies(controller: BrowserController): Promise<void> {
  if (cookieSyncInFlight) return;
  cookieSyncInFlight = true;
  try {
    const ses = session.defaultSession;

    // Electron -> Playwright (manual browsing state for the agent).
    // Keep this one-way to avoid clobbering live auth cookies in the webview.
    const electronCookies = await ses.cookies.get({});
    const incoming = electronCookies
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        expires: typeof c.expirationDate === 'number' ? c.expirationDate : undefined,
        sameSite: toPlaywrightSameSite(c.sameSite) as 'Strict' | 'Lax' | 'None' | undefined,
      }))
      .filter((c) => c.name && c.domain);
    await controller.importCookies(incoming);
  } catch {
    // Best-effort sync; ignore transient cookie failures.
  } finally {
    cookieSyncInFlight = false;
  }
}

function startCookieSync(controller: BrowserController): void {
  if (cookieSyncTimer) clearInterval(cookieSyncTimer);
  cookieSyncTimer = setInterval(() => {
    syncCookies(controller).catch(() => {});
  }, 15000);
  syncCookies(controller).catch(() => {});
}

function stopCookieSync(): void {
  if (cookieSyncTimer) {
    clearInterval(cookieSyncTimer);
    cookieSyncTimer = null;
  }
}

function resolveRendererHtmlPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'),
    path.join(__dirname, '../../renderer/index.html'),
    path.join(__dirname, '../renderer/index.html'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // Fallback to the expected packaged location.
  return path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
}

function setupContextMenu(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('context-menu', (_e, props) => {
      const { x, y } = props;
      const menuTemplate: any[] = [];

      if (props.mediaType === 'image') {
        menuTemplate.push({
          label: 'Open Image in New Tab',
          click: () => {
             mainWindow?.webContents.send('BROWSER_NEW_TAB_REQUEST', props.srcURL);
          }
        });
        menuTemplate.push({
          label: 'Copy Image',
          click: () => contents.copyImageAt(x, y)
        });
        menuTemplate.push({
          label: 'Copy Image Address',
          click: () => {
            clipboard.writeText(props.srcURL);
          }
        });
        menuTemplate.push({ type: 'separator' });
      }

      if (props.linkURL) {
        menuTemplate.push({
          label: 'Open Link in New Tab',
          click: () => {
             mainWindow?.webContents.send('BROWSER_NEW_TAB_REQUEST', props.linkURL);
          }
        });
        menuTemplate.push({
          label: 'Copy Link Address',
          click: () => {
            clipboard.writeText(props.linkURL);
          }
        });
        menuTemplate.push({ type: 'separator' });
      }

      if (props.selectionText) {
        menuTemplate.push({ role: 'copy' });
        menuTemplate.push({ type: 'separator' });
      }

      if (props.isEditable) {
        menuTemplate.push({ role: 'paste' });
        menuTemplate.push({ role: 'cut' });
        menuTemplate.push({ role: 'selectAll' });
        menuTemplate.push({ type: 'separator' });
      }

      menuTemplate.push({
        label: 'Inspect Element',
        click: () => {
          contents.inspectElement(x, y);
        }
      });

      const menu = Menu.buildFromTemplate(menuTemplate);
      menu.popup({ window: BrowserWindow.fromWebContents(contents) || undefined });
    });
  });
}

function createWindow(partition?: string): void {
  // Set consistent User Agent for all webviews
  const basePartition = partition || 'persist:bron-session';
  session.fromPartition(basePartition).setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: partition ? 'Bron Incognito' : 'Bron Agentic Browser',
    backgroundColor: '#121212',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#121212',
      symbolColor: '#e0e0e0',
      height: 42
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      partition: basePartition,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const rendererHtmlPath = resolveRendererHtmlPath();
    mainWindow.loadFile(rendererHtmlPath);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();



  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details);
    if (details.reason !== 'clean-exit') {
      mainWindow?.reload();
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('Renderer unresponsive, reloading...');
    mainWindow?.reload();
  });
}

app.whenReady().then(async () => {
  const template: any[] = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  configureEmbeddedBrowserSecurity();
  configureSessionPolicies();

  // 1. Initialise database
  await initDatabase();
  const settings = getSettings();

  // 2. Create Electron window with profile partition
  const profilePartition = settings.browserProfile && settings.browserProfile !== 'default' 
    ? `persist:bron-profile-${settings.browserProfile}` 
    : 'persist:bron-session';
  createWindow(profilePartition);

  // 4. Create & configure browser controller
  browserController = new BrowserController();
  browserController.setHeadless(settings.headless);
  await browserController.setProfile(settings.browserProfile);
  browserController.setDomainProfileMap(parseDomainProfileMap(settings.domainProfiles));

  // 5. Register IPC handlers
  rendererAutomationController = new RendererAutomationController(() => mainWindow);
  setupIPC(() => mainWindow, browserController, rendererAutomationController);
  setupContextMenu();

  ipcMain.handle(IPC.OPEN_REPORT_WINDOW, async (_e, html: string) => {
    const reportWin = new BrowserWindow({
      width: 900,
      height: 750,
      title: 'Bron Research Report',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    const base64Html = Buffer.from(html).toString('base64');
    reportWin.loadURL(`data:text/html;base64,${base64Html}`);
  });

  ipcMain.handle(IPC.NEW_WINDOW, async () => {
    const settings = getSettings();
    const profilePartition = settings.browserProfile && settings.browserProfile !== 'default' 
      ? `persist:bron-profile-${settings.browserProfile}` 
      : 'persist:bron-session';
    
    createWindow(profilePartition);
  });

  ipcMain.handle(IPC.NEW_INCOGNITO_WINDOW, async () => {
    const partition = `incognito_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    createWindow(partition);
  });

  ipcMain.handle('theme:update-overlay', (_e, { theme, color, symbolColor }: { theme: string, color: string, symbolColor: string }) => {
    const isDark = theme === 'dark';
    const source = isDark ? 'dark' : 'light';
    
    if (nativeTheme.themeSource !== source) {
      nativeTheme.themeSource = source;
    }
    
    // Force color-scheme on all existing web contents immediately
    const scheme = isDark ? 'dark' : 'light';
    webContents.getAllWebContents().forEach(wc => {
      wc.insertCSS(`:root { color-scheme: ${scheme} !important; }`).catch(() => {});
    });

    mainWindow?.setTitleBarOverlay({
      color,
      symbolColor,
      height: 42
    });

    // Also update background color to prevent flashes
    mainWindow?.setBackgroundColor(isDark ? '#121212' : '#f8fafc');
  });

  // 6. Launch automation engine (single-engine mode skips secondary Playwright runtime)
  if (UNIFIED_AGENT_MODE) {
    mainWindow?.webContents.send('status:browserReady');
  } else {
    try {
      await browserController.initialize();
      startCookieSync(browserController);
      mainWindow?.webContents.send('status:browserReady');
    } catch (err: any) {
      console.error('Failed to launch browser:', err);
      mainWindow?.webContents.send('status:browserError', err.message);
    }
  }
});

app.on('window-all-closed', async () => {
  stopCookieSync();
  if (browserController) {
    await browserController.close().catch(() => {});
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Set as default browser handler
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('http', process.execPath, [path.resolve(process.argv[1])]);
    app.setAsDefaultProtocolClient('https', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
}
