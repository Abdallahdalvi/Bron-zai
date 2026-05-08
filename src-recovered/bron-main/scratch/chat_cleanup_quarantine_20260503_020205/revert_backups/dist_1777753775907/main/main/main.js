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
let mainWindow = null;
let browserController = null;
let cookieSyncTimer = null;
let cookieSyncInFlight = false;
const isDev = !electron_1.app.isPackaged;
function configureEmbeddedBrowserSecurity() {
    electron_1.app.on('web-contents-created', (_event, contents) => {
        contents.on('will-attach-webview', (event, webPreferences, params) => {
            delete webPreferences.preload;
            webPreferences.nodeIntegration = false;
            webPreferences.contextIsolation = true;
            webPreferences.sandbox = true;
            webPreferences.allowRunningInsecureContent = false;
            webPreferences.webSecurity = true;
            const src = String(params.src || '');
            if (src && !/^https?:\/\//i.test(src) && src !== 'about:blank') {
                event.preventDefault();
            }
        });
        contents.setWindowOpenHandler(({ url }) => {
            if (/^https?:\/\//i.test(url)) {
                electron_1.shell.openExternal(url).catch(() => { });
            }
            return { action: 'deny' };
        });
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
}
electron_1.app.whenReady().then(async () => {
    electron_1.Menu.setApplicationMenu(null);
    configureEmbeddedBrowserSecurity();
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
    (0, ipc_1.setupIPC)(() => mainWindow, browserController);
    // 6. Launch Playwright Chromium
    try {
        await browserController.initialize();
        startCookieSync(browserController);
        mainWindow?.webContents.send('status:browserReady');
    }
    catch (err) {
        console.error('Failed to launch browser:', err);
        mainWindow?.webContents.send('status:browserError', err.message);
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
//# sourceMappingURL=main.js.map