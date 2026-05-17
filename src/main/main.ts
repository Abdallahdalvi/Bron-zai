import { app, BrowserWindow, Menu, session, shell, ipcMain, clipboard, nativeTheme, webContents } from 'electron';
import fs from 'fs';
import path from 'path';
import { BrowserExtensionRecord, IPC } from '../shared/types';
import { initDatabase, getSettings, saveSettings, getBrowserExtensions, saveBrowserExtension } from './memory';
import { setupIPC } from './ipc';
import { BrowserHostCoordinator } from './browserHost';
import { WebContentsViewController } from './webContentsViewController';
import { initMemorySystem } from '../memory';
import { logger, logInfo, logWarn, logError } from './logger';
import { applySecurityHardening } from './security';
import { initSemanticMemory } from './semanticMemory';
import { initializeStrataIntegration, strata } from '../integrations/strata';
import { startWorkflowScheduler, stopWorkflowScheduler } from './workflowScheduler';

let mainWindow: BrowserWindow | null = null;
let webContentsViewController: WebContentsViewController | null = null;
const browserHost = new BrowserHostCoordinator();
const windowPartitions = new Map<number, string>();
const configuredSessionKeys = new Set<string>();
const loadedExtensionKeys = new Set<string>();

const isDev = !app.isPackaged;
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

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function normalizeProfileName(input: string): string {
  const clean = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return clean || 'default';
}

function partitionForProfile(profileName: string): string {
  const normalized = normalizeProfileName(profileName);
  return normalized !== 'default'
    ? `persist:bron-profile-${normalized}`
    : 'persist:bron-session';
}

function configureEmbeddedBrowserSecurity(): void {
  app.on('web-contents-created', (_event, contents) => {
    // Apply current theme color-scheme on every page load
    contents.on('did-finish-load', () => {
      const isDark = nativeTheme.themeSource === 'dark';
      const scheme = isDark ? 'dark' : 'light';
      contents.insertCSS(`:root { color-scheme: ${scheme} !important; }`).catch((err) => {
        console.warn('[Theme] Failed to insert CSS:', err);
      });
    });

    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Avoid deleting preload if possible, or set to undefined
      /*
      if ((webPreferences as any).preload) {
        delete (webPreferences as any).preload;
      }
      */
      
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
        shell.openExternal(url).catch((err) => {
          console.warn('[Shell] Failed to open external URL:', err);
        });
      }
      return { action: 'deny' };
    });
  });

}

function configureSessionPolicyForKey(key: string, ses: Electron.Session): void {
  if (configuredSessionKeys.has(key)) {
    return;
  }
  configuredSessionKeys.add(key);

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

    // Disable Trusted Types CSP to allow automation scripts on sites like Google Flights
    ses.webRequest.onHeadersReceived((details, callback) => {
      try {
        const headers = details.responseHeaders || {};
        
        // Remove or modify CSP headers that block script injection
        const cspHeaders = ['content-security-policy', 'content-security-policy-report-only', 'x-content-security-policy'];
        for (const header of cspHeaders) {
          if (headers[header]) {
            // Remove trusted-types directives that block inline scripts
            let csp = headers[header][0] || '';
            // Remove require-trusted-types-for and trusted-types directives
            csp = csp.replace(/require-trusted-types-for\s+[^;]*;?/gi, '');
            csp = csp.replace(/trusted-types\s+[^;]*;?/gi, '');
            // Allow unsafe-eval if script-src exists (for automation)
            if (csp.includes('script-src')) {
              csp = csp.replace(/script-src\s+([^;]+)/gi, "script-src $1 'unsafe-eval' 'unsafe-inline'");
            }
            headers[header][0] = csp;
          }
        }
        
        callback({ cancel: false, responseHeaders: headers });
      } catch {
        callback({ cancel: false });
      }
    });
}

function configureSessionPolicies(): void {
  configureSessionPolicyForKey('__default__', session.defaultSession);
  configureSessionPolicyForKey('persist:bron-session', session.fromPartition('persist:bron-session'));
}

function configurePartitionSession(partition: string): Electron.Session {
  const ses = session.fromPartition(partition);
  configureSessionPolicyForKey(partition, ses);
  return ses;
}

function extensionLoadKey(partition: string, sourcePath: string): string {
  return `${partition}::${path.resolve(sourcePath).toLowerCase()}`;
}

function getKnownPersistentPartitions(): string[] {
  const partitions = new Set<string>(['persist:bron-session']);
  for (const partition of windowPartitions.values()) {
    if (partition.startsWith('persist:')) {
      partitions.add(partition);
    }
  }
  return Array.from(partitions);
}

async function loadExtensionRecordIntoPartition(
  record: BrowserExtensionRecord,
  partition: string,
): Promise<BrowserExtensionRecord> {
  if (!record.enabled || !partition.startsWith('persist:')) {
    return record;
  }

  const manifestPath = path.join(record.source_path, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return saveBrowserExtension({
      ...record,
      last_error: 'manifest.json not found in extension directory',
    });
  }

  const key = extensionLoadKey(partition, record.source_path);
  if (loadedExtensionKeys.has(key)) {
    return record;
  }

  const ses = configurePartitionSession(partition);
  try {
    const existing = ses.getAllExtensions().find((ext: any) => {
      const extPath = String((ext as any)?.path || '').trim();
      return (
        ext.id === record.extension_id ||
        (extPath && path.resolve(extPath).toLowerCase() === path.resolve(record.source_path).toLowerCase())
      );
    }) as any;

    const loaded = existing || await ses.loadExtension(record.source_path, { allowFileAccess: true });
    loadedExtensionKeys.add(key);
    return saveBrowserExtension({
      ...record,
      name: String(loaded?.name || loaded?.manifest?.name || record.name || path.basename(record.source_path)),
      extension_id: String(loaded?.id || record.extension_id || ''),
      version: String(loaded?.version || loaded?.manifest?.version || record.version || ''),
      last_error: '',
      enabled: true,
    });
  } catch (err) {
    return saveBrowserExtension({
      ...record,
      last_error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function loadConfiguredExtensionsIntoPartition(partition: string): Promise<void> {
  if (!partition.startsWith('persist:')) return;
  const extensions = getBrowserExtensions().filter((record) => record.enabled);
  for (const record of extensions) {
    await loadExtensionRecordIntoPartition(record, partition);
  }
}

async function installBrowserExtensionRecord(record: BrowserExtensionRecord): Promise<BrowserExtensionRecord> {
  let latest = record;
  for (const partition of getKnownPersistentPartitions()) {
    latest = await loadExtensionRecordIntoPartition(latest, partition);
  }
  return latest;
}

async function removeBrowserExtensionRecord(record: BrowserExtensionRecord): Promise<void> {
  for (const partition of getKnownPersistentPartitions()) {
    const ses = configurePartitionSession(partition);
    const ext = ses.getAllExtensions().find((entry: any) => {
      const extPath = String((entry as any)?.path || '').trim();
      return (
        entry.id === record.extension_id ||
        (extPath && path.resolve(extPath).toLowerCase() === path.resolve(record.source_path).toLowerCase())
      );
    }) as any;
    if (ext?.id) {
      try {
        ses.removeExtension(ext.id);
      } catch {
        // Ignore extension unload failures.
      }
    }
    loadedExtensionKeys.delete(extensionLoadKey(partition, record.source_path));
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

function createWindow(partition?: string): BrowserWindow {
  // Set a consistent user agent for the hosted browser session.
  const basePartition = partition || 'persist:bron-session';
  configurePartitionSession(basePartition).setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
  void loadConfiguredExtensionsIntoPartition(basePartition).catch((err) => {
    console.warn('[Extensions] Failed to load configured extensions:', err);
  });

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
      partition: basePartition,
      additionalArguments: [
        `--bron-window-partition=${basePartition}`,
        `--bron-window-incognito=${String(!basePartition.startsWith('persist:'))}`,
      ],
    },
  });
  const win = mainWindow;

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    const rendererHtmlPath = resolveRendererHtmlPath();
    win.loadFile(rendererHtmlPath);
  }

  win.once('ready-to-show', () => {
    win.show();
  });
  windowPartitions.set(win.webContents.id, basePartition);

  win.setMenuBarVisibility(false);
  win.removeMenu();



  win.on('closed', () => {
    browserHost.clearWindow(win.webContents.id);
    windowPartitions.delete(win.webContents.id);
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details);
    if (details.reason !== 'clean-exit') {
      win.reload();
    }
  });

  win.webContents.on('unresponsive', () => {
    console.warn('Renderer unresponsive, reloading...');
    win.reload();
  });

  return win;
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

  // 1. Initialise database and core subsystems
  await logger.initialize();
  logInfo('Bron starting up...', 'Main');
  
  await initDatabase();
  await initMemorySystem();
  
  // Initialize new systems
  try {
    await initSemanticMemory();
    logInfo('Semantic memory initialized', 'Main');
  } catch (err) {
    logWarn('Semantic memory initialization failed, falling back to keyword search', 'Main', {}, err as Error);
  }
  
  await initializeStrataIntegration();
  logInfo('Strata MCP integration initialized', 'Main');
  
  // Apply security hardening
  applySecurityHardening();
  
  const settings = getSettings();
  browserHost.setBackend('webcontentsview');

  // 2. Create Electron window with profile partition
  const profilePartition = partitionForProfile(settings.browserProfile);
  createWindow(profilePartition);

  // 4. Create the single live-browser automation controller.
  webContentsViewController = new WebContentsViewController(
    () => mainWindow,
    (windowWebContentsId) => windowPartitions.get(windowWebContentsId) || 'persist:bron-session',
    browserHost,
  );

  // 5. Register IPC handlers against the single live controller.
  const agentController = webContentsViewController!;
  setupIPC(() => mainWindow, agentController, {
    installExtension: installBrowserExtensionRecord,
    removeExtension: removeBrowserExtensionRecord,
    browserHost,
  });
  setupContextMenu();
  startWorkflowScheduler({
    browserController: agentController,
    getWindow: () => mainWindow,
  });

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
    reportWin.loadURL(`data:text/html;charset=utf-8;base64,${base64Html}`);
  });

  ipcMain.handle(IPC.NEW_WINDOW, async () => {
    const settings = getSettings();
    const profilePartition = partitionForProfile(settings.browserProfile);
    
    createWindow(profilePartition);
  });

  ipcMain.handle(IPC.NEW_INCOGNITO_WINDOW, async () => {
    const partition = `incognito_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    createWindow(partition);
  });

  ipcMain.handle(IPC.SWITCH_BROWSER_PROFILE, async (event, profileName: string) => {
    const normalized = normalizeProfileName(profileName);
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    const nextPartition = partitionForProfile(normalized);

    saveSettings({ browserProfile: normalized } as any);

    const replacement = createWindow(nextPartition);
    replacement.once('ready-to-show', () => {
      currentWindow?.close();
    });

    return { switched: true };
  });

  ipcMain.handle(IPC.GET_RUNTIME_CONTEXT, async (event) => {
    const senderId = event.sender.id;
    const windowPartition = windowPartitions.get(senderId) || 'persist:bron-session';
    return browserHost.buildRuntimeContext({
      windowPartition,
      incognito: !windowPartition.startsWith('persist:'),
    });
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
      wc.insertCSS(`:root { color-scheme: ${scheme} !important; }`).catch((err) => {
        console.warn('[Theme] Failed to update overlay CSS:', err);
      });
    });

    mainWindow?.setTitleBarOverlay({
      color,
      symbolColor,
      height: 42
    });

    // Also update background color to prevent flashes
    mainWindow?.setBackgroundColor(isDark ? '#121212' : '#f8fafc');
  });

  // 6. Signal readiness once the live browser bridge has had a moment to initialize.
  console.log('[Bron] Unified live-browser mode active');
  setTimeout(() => {
    mainWindow?.webContents.send('status:browserReady');
  }, 500);
});

app.on('window-all-closed', async () => {
  stopWorkflowScheduler();
  webContentsViewController?.dispose();
  webContentsViewController = null;
  
  // Clean up Strata MCP connections
  try {
    await strata.disconnectAll();
    logInfo('Strata MCP connections closed', 'Cleanup');
  } catch (err) {
    logError('Strata MCP cleanup error', 'Cleanup', {}, err as Error);
  }
  
  // Flush logs
  await logger.dispose();
  
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
