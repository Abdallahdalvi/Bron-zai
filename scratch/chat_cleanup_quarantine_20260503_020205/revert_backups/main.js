"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const memory_1 = require("./memory");
const ipc_1 = require("./ipc");
const browserController_1 = require("./browserController");
const automationController_1 = require("./automationController");
let mainWindow = null;
let browserController = null;
let cookieSyncTimer = null;
let cookieSyncInFlight = false;
let rendererAutomationController = null;
const isDev = !electron_1.app.isPackaged;
const UNIFIED_AGENT_MODE = true;
electron_1.app.commandLine.appendSwitch('disable-features', 'WebAuthentication,WebAuthenticationUI,FedCm,CredentialManagement');
const TRACKER_HOST_BLOCKLIST = new Set([
    'doubleclick.net',
    'googlesyndication.com',
    'adservice.google.com',
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
]);
const DENIED_PERMISSIONS = new Set([
    'notifications',
    'geolocation',
    'midi',
    'midiSysex',
    'pointerLock',
    'fullscreen',
    'openExternal',
    'display-capture',
    'window-placement',
    'top-level-storage-access',
    'speaker-selection',
    'publickey-credentials-get',
    'publickey-credentials-create',
    'public-key-credentials-get',
    'public-key-credentials-create',
]);
function configureEmbeddedBrowserSecurity() {
    electron_1.app.on('web-contents-created', (_event, contents) => {
        contents.on('will-attach-webview', (event, webPreferences, params) => {
            delete webPreferences.preload;
            webPreferences.nodeIntegration = false;
            webPreferences.contextIsolation = true;
            webPreferences.sandbox = true;
            webPreferences.allowRunningInsecureContent = false;
            webPreferences.webSecurity = true;
            webPreferences.disableBlinkFeatures = 'WebAuthentication,CredentialManagement';
            const src = String(params.src || '');
            if (src && !/^https?:\/\//i.test(src) && src !== 'about:blank') {
                event.preventDefault();
            }
        });
        contents.setWindowOpenHandler(({ url }) => {
            // Allow internal popups for printing/exporting
            if (url === 'about:blank' || url === '') {
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: {
                        width: 800,
                        height: 600,
                        show: true
                    }
                };
            }
            if (/^https?:\/\//i.test(url)) {
                electron_1.shell.openExternal(url).catch(() => { });
            }
            return { action: 'deny' };
        });
    });
}
function configureSessionPolicies() {
    const ses = electron_1.session.defaultSession;
    ses.setPermissionCheckHandler((_wc, permission) => {
        if (DENIED_PERMISSIONS.has(permission))
            return false;
        return true;
    });
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
        if (DENIED_PERMISSIONS.has(permission)) {
            callback(false);
            return;
        }
        // Default deny to avoid repetitive native permission prompts in production UI.
        callback(false);
    });
    ses.webRequest.onBeforeRequest((details, callback) => {
        try {
            if (details.resourceType === 'mainFrame') {
                callback({ cancel: false });
                return;
            }
            const parsed = new URL(details.url);
            const host = parsed.hostname.toLowerCase();
            const blockedByHost = Array.from(TRACKER_HOST_BLOCKLIST).some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
            if (blockedByHost) {
                callback({ cancel: true });
                return;
            }
        }
        catch {
            // Ignore malformed URLs.
        }
        callback({ cancel: false });
    });
}
function parseDomainProfileMap(raw) {
    const text = String(raw || '').trim();
    if (!text)
        return {};
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return {};
        const map = {};
        for (const [domain, profile] of Object.entries(parsed)) {
            const d = domain.trim().toLowerCase();
            const p = String(profile || '').trim();
            if (!d || !p)
                continue;
            map[d] = p;
        }
        return map;
    }
    catch {
        return {};
    }
}
function toPlaywrightSameSite(sameSite) {
    if (!sameSite)
        return undefined;
    const s = sameSite.toLowerCase();
    if (s === 'strict')
        return 'Strict';
    if (s === 'lax')
        return 'Lax';
    if (s === 'no_restriction')
        return 'None';
    return undefined;
}
function toElectronSameSite(sameSite) {
    if (!sameSite)
        return 'unspecified';
    const s = sameSite.toLowerCase();
    if (s === 'strict')
        return 'strict';
    if (s === 'lax')
        return 'lax';
    if (s === 'none')
        return 'no_restriction';
    return 'unspecified';
}
function buildCookieUrl(domain, secure, pathName) {
    const raw = String(domain || '').trim();
    if (!raw)
        return null;
    const host = raw.replace(/^\./, '');
    if (!host)
        return null;
    const scheme = secure ? 'https' : 'http';
    const pathPart = pathName && pathName.startsWith('/') ? pathName : '/';
    return `${scheme}://${host}${pathPart}`;
}
async function syncCookies(controller) {
    if (cookieSyncInFlight)
        return;
    cookieSyncInFlight = true;
    try {
        const ses = electron_1.session.defaultSession;
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
            sameSite: toPlaywrightSameSite(c.sameSite),
        }))
            .filter((c) => c.name && c.domain);
        await controller.importCookies(incoming);
    }
    catch {
        // Best-effort sync; ignore transient cookie failures.
    }
    finally {
        cookieSyncInFlight = false;
    }
}
function startCookieSync(controller) {
    if (cookieSyncTimer)
        clearInterval(cookieSyncTimer);
    cookieSyncTimer = setInterval(() => {
        syncCookies(controller).catch(() => { });
    }, 15000);
    syncCookies(controller).catch(() => { });
}
function stopCookieSync() {
    if (cookieSyncTimer) {
        clearInterval(cookieSyncTimer);
        cookieSyncTimer = null;
    }
}
function resolveRendererHtmlPath() {
    const candidates = [
        path_1.default.join(electron_1.app.getAppPath(), 'dist', 'renderer', 'index.html'),
        path_1.default.join(__dirname, '../../renderer/index.html'),
        path_1.default.join(__dirname, '../renderer/index.html'),
    ];
    for (const candidate of candidates) {
        if (fs_1.default.existsSync(candidate))
            return candidate;
    }
    // Fallback to the expected packaged location.
    return path_1.default.join(electron_1.app.getAppPath(), 'dist', 'renderer', 'index.html');
}
function createWindow() {
    // Set consistent User Agent for all webviews
    electron_1.session.defaultSession.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
    mainWindow = new electron_1.BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 960,
        minHeight: 640,
        title: 'Bron Agentic Browser',
        backgroundColor: '#0f172a',
        show: false,
        frame: true,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webviewTag: true,
        },
    });
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    }
    else {
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
electron_1.app.whenReady().then(async () => {
    electron_1.Menu.setApplicationMenu(null);
    configureEmbeddedBrowserSecurity();
    configureSessionPolicies();
    // 1. Initialise database
    await (0, memory_1.initDatabase)();
    // 2. Create Electron window
    createWindow();
    // 3. Read settings
    const settings = (0, memory_1.getSettings)();
    // 4. Create & configure browser controller
    browserController = new browserController_1.BrowserController();
    browserController.setHeadless(settings.headless);
    await browserController.setProfile(settings.browserProfile);
    browserController.setDomainProfileMap(parseDomainProfileMap(settings.domainProfiles));
    // 5. Register IPC handlers
    rendererAutomationController = new automationController_1.RendererAutomationController(() => mainWindow);
    (0, ipc_1.setupIPC)(() => mainWindow, browserController, rendererAutomationController);
    // 6. Launch automation engine (single-engine mode skips secondary Playwright runtime)
    if (UNIFIED_AGENT_MODE) {
        mainWindow?.webContents.send('status:browserReady');
    }
    else {
        try {
            await browserController.initialize();
            startCookieSync(browserController);
            mainWindow?.webContents.send('status:browserReady');
        }
        catch (err) {
            console.error('Failed to launch browser:', err);
            mainWindow?.webContents.send('status:browserError', err.message);
        }
    }
});
electron_1.app.on('window-all-closed', async () => {
    stopCookieSync();
    if (browserController) {
        await browserController.close().catch(() => { });
    }
    electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
// Set as default browser handler
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        electron_1.app.setAsDefaultProtocolClient('http', process.execPath, [path_1.default.resolve(process.argv[1])]);
        electron_1.app.setAsDefaultProtocolClient('https', process.execPath, [path_1.default.resolve(process.argv[1])]);
    }
}
else {
    electron_1.app.setAsDefaultProtocolClient('http');
    electron_1.app.setAsDefaultProtocolClient('https');
}
//# sourceMappingURL=main.js.map