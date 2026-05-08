"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserController = void 0;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const playwright_extra_1 = require("playwright-extra");
const puppeteer_extra_plugin_stealth_1 = __importDefault(require("puppeteer-extra-plugin-stealth"));
playwright_extra_1.chromium.use((0, puppeteer_extra_plugin_stealth_1.default)());
const TRACKER_HOST_BLOCKLIST = [
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
];
/**
 * BrowserController wraps a Playwright-connected Chrome instance.
 * Manual UI and agent actions can stay aligned through URL mirroring/cookie sync.
 */
class BrowserController {
    browser = null;
    context = null;
    contextAlive = false;
    pages = new Map();
    activeTabId = null;
    agentTabId = null;
    tabCounter = 0;
    headless = true;
    currentProfile = 'default';
    domainProfileMap = {};
    recovering = null;
    shuttingDown = false;
    suppressDisconnectRecovery = false;
    setHeadless(h) {
        this.headless = h;
    }
    getCurrentProfile() {
        return this.currentProfile;
    }
    /**
     * Accepts domain -> profile mapping.
     * Example:
     * {
     *   "amazon.in": "shopping",
     *   "flipkart.com": "shopping",
     *   "linkedin.com": "work"
     * }
     */
    setDomainProfileMap(rawMap) {
        const next = {};
        if (rawMap && typeof rawMap === 'object') {
            for (const [domain, profile] of Object.entries(rawMap)) {
                const key = domain.trim().toLowerCase();
                const value = String(profile || '').trim();
                if (!key || !value)
                    continue;
                next[key] = this.normalizeProfileName(value);
            }
        }
        this.domainProfileMap = next;
    }
    async setProfile(profileName) {
        const normalized = this.normalizeProfileName(profileName);
        if (normalized === this.currentProfile)
            return;
        this.currentProfile = normalized;
        if (this.context || this.browser) {
            await this.recoverBrowser('profile-switch');
        }
    }
    async initialize() {
        this.shuttingDown = false;
        await this.launchBrowserAndRestore();
    }
    async close() {
        this.shuttingDown = true;
        this.persistSessionSnapshot();
        await this.teardownBrowser();
        this.pages.clear();
        this.activeTabId = null;
    }
    // ---------- Tab management ----------
    genTabId() {
        return `tab_${++this.tabCounter}_${Date.now()}`;
    }
    attachPageLifecycle(id, page) {
        page.on('close', () => {
            this.pages.delete(id);
            if (this.activeTabId === id) {
                const remaining = Array.from(this.pages.keys());
                this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
            }
            this.persistSessionSnapshot();
        });
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) {
                this.persistSessionSnapshot();
            }
        });
    }
    async newTab(url) {
        await this.ensureReady();
        if (!this.context)
            throw new Error('Browser not initialized');
        const page = await this.context.newPage();
        const id = this.genTabId();
        this.pages.set(id, page);
        this.activeTabId = id;
        this.attachPageLifecycle(id, page);
        if (url) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
                await this.waitForPageSettle(page, 'navigation');
            }
            catch {
                // Keep tab alive even when URL fails.
            }
        }
        this.persistSessionSnapshot();
        return id;
    }
    async closeTab(tabId) {
        await this.ensureReady();
        const page = this.pages.get(tabId);
        if (page) {
            await page.close().catch(() => { });
            this.persistSessionSnapshot();
        }
    }
    async switchTab(tabId) {
        if (!this.pages.has(tabId))
            return;
        this.activeTabId = tabId;
        const page = this.pages.get(tabId);
        // Don't wait for bringToFront, it's slow
        page.bringToFront().catch(() => { });
        this.persistSessionSnapshot();
    }
    setAgentTabId(id) {
        this.agentTabId = id;
    }
    getAgentPage() {
        if (!this.agentTabId)
            return this.getActivePage();
        return this.pages.get(this.agentTabId) ?? this.getActivePage();
    }
    getActivePage() {
        if (!this.activeTabId)
            return null;
        return this.pages.get(this.activeTabId) ?? null;
    }
    getActiveTabId() {
        return this.activeTabId;
    }
    // ---------- Navigation ----------
    async navigate(url) {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return;
        await this.autoHandleCommonTransientUi(page);
        let target = url.trim();
        if (!/^https?:\/\//i.test(target) && !target.startsWith('about:')) {
            if (target.includes('.') && !target.includes(' ')) {
                target = 'https://' + target;
            }
            else {
                target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
            }
        }
        const routedProfile = this.getProfileForUrl(target);
        if (routedProfile && routedProfile !== this.currentProfile) {
            this.currentProfile = routedProfile;
            await this.recoverBrowser('domain-profile-route', target);
            return;
        }
        try {
            await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 25000 });
            await this.waitForPageSettle(page, 'navigation');
            await this.autoHandleCommonTransientUi(page);
        }
        catch {
            // Keep operating even if target fails.
        }
        this.persistSessionSnapshot();
    }
    async goBack() {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return;
        await page.goBack({ timeout: 12000 }).catch(() => { });
        await this.waitForPageSettle(page, 'navigation');
        this.persistSessionSnapshot();
    }
    async goForward() {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return;
        await page.goForward({ timeout: 12000 }).catch(() => { });
        await this.waitForPageSettle(page, 'navigation');
        this.persistSessionSnapshot();
    }
    async refresh() {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return;
        await page.reload({ timeout: 18000 }).catch(() => { });
        await this.waitForPageSettle(page, 'navigation');
        this.persistSessionSnapshot();
    }
    // ---------- Agent actions ----------
    async click(selector) {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return 'No active page';
        await this.autoHandleCommonTransientUi(page);
        try {
            await page.click(selector, { timeout: 5000 });
            await this.waitForPageSettle(page, 'action');
            const inviteHandled = await this.autoHandleLinkedInInviteDialog(page, selector);
            const transientHandled = await this.autoHandleCommonTransientUi(page);
            this.persistSessionSnapshot();
            return this.decorateActionResult(`Clicked: ${selector}`, inviteHandled, transientHandled);
        }
        catch (e) {
            try {
                await this.autoHandleCommonTransientUi(page);
                await page.click(selector, { timeout: 3000, force: true });
                await this.waitForPageSettle(page, 'action');
                const inviteHandled = await this.autoHandleLinkedInInviteDialog(page, selector);
                const transientHandled = await this.autoHandleCommonTransientUi(page);
                this.persistSessionSnapshot();
                return this.decorateActionResult(`Clicked (forced): ${selector}`, inviteHandled, transientHandled);
            }
            catch {
                try {
                    await this.autoHandleCommonTransientUi(page);
                    await page.evaluate((sel) => {
                        const el = document.querySelector(sel);
                        if (el)
                            el.click();
                    }, selector);
                    await this.waitForPageSettle(page, 'action');
                    const inviteHandled = await this.autoHandleLinkedInInviteDialog(page, selector);
                    const transientHandled = await this.autoHandleCommonTransientUi(page);
                    this.persistSessionSnapshot();
                    return this.decorateActionResult(`Clicked (JS): ${selector}`, inviteHandled, transientHandled);
                }
                catch {
                    const alt = await this.describeActionAlternatives(page, selector);
                    const base = `Click failed on "${selector}": ${String(e?.message || '').split('\n')[0]}`;
                    return alt ? `${base}. ${alt}` : base;
                }
            }
        }
    }
    async selectOption(selector, value) {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return 'No active page';
        await this.autoHandleCommonTransientUi(page);
        try {
            await page.selectOption(selector, value, { timeout: 5000 });
            await this.waitForPageSettle(page, 'action');
            const transientHandled = await this.autoHandleCommonTransientUi(page);
            this.persistSessionSnapshot();
            return this.decorateActionResult(`Selected "${value}" in ${selector}`, transientHandled);
        }
        catch {
            try {
                await this.autoHandleCommonTransientUi(page);
                await page.evaluate(({ sel, val }) => {
                    const el = document.querySelector(sel);
                    if (!el)
                        return;
                    el.value = val;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }, { sel: selector, val: value });
                await this.waitForPageSettle(page, 'action');
                const transientHandled = await this.autoHandleCommonTransientUi(page);
                this.persistSessionSnapshot();
                return this.decorateActionResult(`Selected "${value}" in ${selector} (JS)`, transientHandled);
            }
            catch (e2) {
                return `Select failed: ${e2.message}`;
            }
        }
    }
    async autoHandleLinkedInSignup(page) {
        try {
            const handled = await page.evaluate(() => {
                const host = window.location.hostname.toLowerCase();
                if (!host.includes('linkedin.com'))
                    return null;
                // Contextual sign-in modal
                const modal = document.querySelector('.contextual-sign-in-modal');
                if (modal) {
                    const dismiss = modal.querySelector('.contextual-sign-in-modal__modal-dismiss');
                    if (dismiss) {
                        dismiss.click();
                        return 'LinkedIn signup modal dismissed';
                    }
                }
                // Generic artdeco modal with signup text
                const artdeco = document.querySelector('.artdeco-modal');
                if (artdeco && artdeco.textContent?.toLowerCase().includes('sign in')) {
                    const close = artdeco.querySelector('.artdeco-modal__dismiss');
                    if (close) {
                        close.click();
                        return 'LinkedIn artdeco signin modal closed';
                    }
                }
                return null;
            });
            return handled;
        }
        catch {
            return null;
        }
    }
    async autoHandleLinkedInInviteDialog(page, clickedSelector) {
        try {
            const handled = await page.evaluate((selectorHint) => {
                const host = window.location.hostname.toLowerCase();
                if (!host.includes('linkedin.com'))
                    return null;
                const hint = String(selectorHint || '').toLowerCase();
                const inviteLikeClick = hint.includes('connect') || hint.includes('invite');
                const dialog = document.querySelector('[role="dialog"]') ||
                    document.querySelector('.artdeco-modal');
                if (!dialog)
                    return null;
                const dialogText = (dialog.textContent || '').toLowerCase();
                const inviteDialog = /connect|invite|add a note|personalize/i.test(dialogText);
                if (!inviteDialog && !inviteLikeClick)
                    return null;
                const buttons = Array.from(dialog.querySelectorAll('button'));
                const findButton = (patterns) => {
                    for (const btn of buttons) {
                        const txt = (btn.textContent || '').trim().toLowerCase();
                        const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
                        const combined = `${txt} ${aria}`.trim();
                        if (!combined)
                            continue;
                        if (patterns.some((p) => p.test(combined)))
                            return btn;
                    }
                    return null;
                };
                const withoutNote = findButton([
                    /send without/,
                    /without a note/,
                ]);
                if (withoutNote) {
                    withoutNote.click();
                    return 'LinkedIn invite sent without note';
                }
                const noteInput = dialog.querySelector('textarea, [contenteditable="true"]');
                if (noteInput) {
                    if (noteInput instanceof HTMLTextAreaElement) {
                        noteInput.value = '';
                        noteInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    else {
                        noteInput.textContent = '';
                        noteInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
                const sendButton = findButton([
                    /^send$/,
                    /send invite/,
                    /done/,
                ]);
                if (sendButton) {
                    sendButton.click();
                    return 'LinkedIn invite sent';
                }
                return null;
            }, clickedSelector);
            if (!handled)
                return null;
            await page.waitForTimeout(450);
            return handled;
        }
        catch {
            return null;
        }
    }
    async autoHandleCommonTransientUi(page) {
        try {
            const handled = await page.evaluate(() => {
                const isVisible = (el) => {
                    if (!el || !(el instanceof HTMLElement))
                        return false;
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 4 || rect.height < 4)
                        return false;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
                        return false;
                    return true;
                };
                const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .modal, .popup, .consent, .cookie, .overlay'))
                    .filter((el) => isVisible(el))
                    .slice(0, 3);
                if (dialogs.length === 0)
                    return null;
                const dismissalPatterns = [
                    /not now/,
                    /no thanks/,
                    /skip/,
                    /dismiss/,
                    /close/,
                    /later/,
                    /cancel/,
                    /x$/,
                ];
                const consentContinuePatterns = [
                    /^ok$/,
                    /got it/,
                    /accept all/,
                    /^accept$/,
                    /i agree/,
                    /allow essential/,
                ];
                const riskyPatterns = [
                    /pay/,
                    /purchase/,
                    /place order/,
                    /confirm$/,
                    /delete$/,
                ];
                const securityDialogPatterns = [
                    /passkey/,
                    /security key/,
                    /windows security/,
                    /webauthn/,
                    /verify it'?s you/,
                    /use your device/,
                ];
                const tryClickByPatterns = (root, patterns) => {
                    const buttons = Array.from(root.querySelectorAll('button, [role="button"], a'));
                    for (const btn of buttons) {
                        if (!isVisible(btn))
                            continue;
                        const txt = ((btn.textContent || '') + ' ' + (btn.getAttribute('aria-label') || '')).trim().toLowerCase();
                        if (!txt)
                            continue;
                        if (riskyPatterns.some((p) => p.test(txt)))
                            continue;
                        if (patterns.some((p) => p.test(txt))) {
                            btn.click();
                            return txt.slice(0, 60);
                        }
                    }
                    return null;
                };
                for (const dialog of dialogs) {
                    const dialogText = (dialog.textContent || '').toLowerCase();
                    const looksLikeSecurityDialog = securityDialogPatterns.some((p) => p.test(dialogText));
                    if (looksLikeSecurityDialog) {
                        const cancelled = tryClickByPatterns(dialog, [/cancel/, /close/, /not now/, /dismiss/, /x$/]);
                        if (cancelled)
                            return `handled popup: ${cancelled}`;
                        continue;
                    }
                    const dismissed = tryClickByPatterns(dialog, dismissalPatterns);
                    if (dismissed)
                        return `handled popup: ${dismissed}`;
                    const looksLikeConsent = /cookie|consent|privacy|gdpr|tracking|ads/i.test(dialogText);
                    if (looksLikeConsent) {
                        const continued = tryClickByPatterns(dialog, consentContinuePatterns);
                        if (continued)
                            return `handled popup: ${continued}`;
                    }
                    const closeIcon = Array.from(dialog.querySelectorAll('[aria-label*="close" i], .close, .btn-close'))
                        .find((el) => isVisible(el));
                    if (closeIcon && closeIcon instanceof HTMLElement) {
                        closeIcon.click();
                        return 'handled popup: close';
                    }
                }
                return null;
            });
            if (!handled) {
                const liHandled = await this.autoHandleLinkedInSignup(page);
                if (liHandled)
                    return liHandled;
                return null;
            }
            await page.waitForTimeout(300);
            return handled;
        }
        catch {
            return null;
        }
    }
    decorateActionResult(base, ...notes) {
        const uniq = Array.from(new Set(notes.filter((n) => !!n && n.trim().length > 0)));
        if (uniq.length === 0)
            return base;
        return `${base} (${uniq.join('; ')})`;
    }
    async describeActionAlternatives(page, selectorHint) {
        try {
            return await page.evaluate((hint) => {
                const norm = String(hint || '').toLowerCase();
                const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
                const labels = [];
                for (const el of buttons) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 6 || rect.height < 6)
                        continue;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden')
                        continue;
                    const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
                    if (!text)
                        continue;
                    const clean = text.toLowerCase();
                    if (!labels.includes(clean))
                        labels.push(clean);
                    if (labels.length >= 30)
                        break;
                }
                if (labels.length === 0)
                    return null;
                if ((norm.includes('connect') || norm.includes('invite')) && labels.some((t) => t.includes('follow'))) {
                    return 'Connect/Invite not visible here; Follow is available. Skip this target and continue.';
                }
                const notable = labels
                    .filter((t) => /follow|message|connect|invite|apply|continue|submit|next|skip/i.test(t))
                    .slice(0, 8);
                if (notable.length > 0) {
                    return `Visible actions include: ${notable.join(', ')}`;
                }
                return null;
            }, selectorHint);
        }
        catch {
            return null;
        }
    }
    async typeText(selector, text) {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return 'No active page';
        await this.autoHandleCommonTransientUi(page);
        try {
            await page.fill(selector, text, { timeout: 5000 });
            const transientHandled = await this.autoHandleCommonTransientUi(page);
            this.persistSessionSnapshot();
            return this.decorateActionResult(`Typed "${text}" into ${selector}`, transientHandled);
        }
        catch {
            try {
                await this.autoHandleCommonTransientUi(page);
                await page.click(selector, { timeout: 3000 });
                await page.keyboard.type(text, { delay: 30 });
                const transientHandled = await this.autoHandleCommonTransientUi(page);
                this.persistSessionSnapshot();
                return this.decorateActionResult(`Typed "${text}" into ${selector} (keyboard)`, transientHandled);
            }
            catch (e2) {
                return `Type failed: ${e2.message}`;
            }
        }
    }
    async pressEnter() {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return 'No active page';
        await this.autoHandleCommonTransientUi(page);
        await page.keyboard.press('Enter');
        await this.waitForPageSettle(page, 'navigation');
        const transientHandled = await this.autoHandleCommonTransientUi(page);
        this.persistSessionSnapshot();
        return this.decorateActionResult('Pressed Enter', transientHandled);
    }
    async scroll(direction) {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return 'No active page';
        const delta = direction === 'up' ? -500 : 500;
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(700);
        return `Scrolled ${direction}`;
    }
    async search(query) {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return 'No active page';
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 25000,
        });
        await this.waitForPageSettle(page, 'navigation');
        this.persistSessionSnapshot();
        return `Searched Google for: ${query}`;
    }
    // ---------- Cookie bridge ----------
    async exportCookies() {
        await this.ensureReady();
        if (!this.context)
            return [];
        try {
            return await this.context.cookies();
        }
        catch {
            return [];
        }
    }
    async importCookies(cookies) {
        await this.ensureReady();
        if (!this.context || !Array.isArray(cookies) || cookies.length === 0)
            return 0;
        const normalized = cookies
            .map((c) => this.normalizeCookieForPlaywright(c))
            .filter((c) => !!c);
        if (normalized.length === 0)
            return 0;
        try {
            await this.context.addCookies(normalized);
            return normalized.length;
        }
        catch {
            return 0;
        }
    }
    // ---------- State extraction ----------
    async getScreenshot() {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return '';
        try {
            const buf = await page.screenshot({ type: 'jpeg', quality: 85 });
            return buf.toString('base64');
        }
        catch {
            return '';
        }
    }
    async getTabs() {
        await this.ensureReady();
        const tabs = [];
        for (const [id, page] of this.pages) {
            let title = '';
            let url = '';
            try {
                title = await page.title();
                url = page.url();
            }
            catch {
                title = 'Loading...';
                url = '';
            }
            tabs.push({ id, title, url, active: id === this.activeTabId });
        }
        return tabs;
    }
    async getBrowserState(options) {
        await this.ensureReady();
        const page = this.getActivePage();
        const tabs = await this.getTabs();
        if (!page) {
            return {
                url: '',
                title: '',
                visibleText: '',
                clickableElements: [],
                inputFields: [],
                tabs,
            };
        }
        let url = '';
        let title = '';
        try {
            url = page.url();
            title = await page.title();
        }
        catch { }
        const visibleText = await this.extractVisibleText(page);
        const clickableElements = await this.extractClickableElements(page);
        const inputFields = await this.extractInputFields(page);
        const screenshot = options?.includeScreenshot ? await this.getScreenshot() : undefined;
        return { url, title, visibleText, clickableElements, inputFields, tabs, screenshot };
    }
    async extractVisibleText(page) {
        try {
            const text = await page.evaluate(() => {
                const raw = document.body?.innerText || '';
                return raw.replace(/\n{3,}/g, '\n\n').trim();
            });
            return text.slice(0, 10000);
        }
        catch {
            return '';
        }
    }
    async extractClickableElements(page) {
        try {
            return await page.evaluate(() => {
                const els = [];
                const clickable = document.querySelectorAll('a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"]');
                const seen = new Set();
                let count = 0;
                clickable.forEach((el) => {
                    if (count >= 60)
                        return;
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0)
                        return;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
                        return;
                    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
                    if (!text || seen.has(text))
                        return;
                    seen.add(text);
                    const tag = el.tagName.toLowerCase();
                    const role = el.getAttribute('role') || undefined;
                    let selector = '';
                    const id = el.getAttribute('id');
                    const ariaLabel = el.getAttribute('aria-label');
                    const dataTestId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
                    if (id) {
                        selector = `#${CSS.escape(id)}`;
                    }
                    else if (dataTestId) {
                        selector = `[data-testid="${dataTestId}"]`;
                    }
                    else if (ariaLabel) {
                        selector = `${tag}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
                    }
                    else if (text.length > 0 && text.length < 50) {
                        selector = `text="${text.slice(0, 40)}"`;
                    }
                    else {
                        return;
                    }
                    els.push({ text, tag, role, selector });
                    count++;
                });
                return els;
            });
        }
        catch {
            return [];
        }
    }
    async extractInputFields(page) {
        try {
            return await page.evaluate(() => {
                const fields = [];
                const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"], [role="combobox"], [role="searchbox"], [role="textbox"]');
                let count = 0;
                inputs.forEach((el) => {
                    if (count >= 20)
                        return;
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0)
                        return;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden')
                        return;
                    const input = el;
                    const type = input.type || input.getAttribute('role') || input.tagName.toLowerCase();
                    const placeholder = input.placeholder || input.getAttribute('aria-placeholder') || undefined;
                    let label;
                    const ariaLabel = input.getAttribute('aria-label');
                    if (ariaLabel) {
                        label = ariaLabel;
                    }
                    else if (input.id) {
                        const labelEl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
                        if (labelEl)
                            label = (labelEl.textContent || '').trim().slice(0, 60);
                    }
                    let selector = '';
                    const dataTestId = input.getAttribute('data-testid') || input.getAttribute('data-test-id');
                    if (input.id) {
                        selector = `#${CSS.escape(input.id)}`;
                    }
                    else if (dataTestId) {
                        selector = `[data-testid="${dataTestId}"]`;
                    }
                    else if (input.name) {
                        selector = `${input.tagName.toLowerCase()}[name="${input.name.replace(/"/g, '\\"')}"]`;
                    }
                    else if (ariaLabel) {
                        selector = `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
                    }
                    else if (placeholder) {
                        selector = `[placeholder="${placeholder.replace(/"/g, '\\"')}"]`;
                    }
                    else {
                        return;
                    }
                    fields.push({ placeholder, label, type, selector });
                    count++;
                });
                return fields;
            });
        }
        catch {
            return [];
        }
    }
    // ---------- Visual effect ----------
    async highlightElement(selector) {
        await this.ensureReady();
        const page = this.getActivePage();
        if (!page)
            return;
        try {
            await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el)
                    return;
                const rect = el.getBoundingClientRect();
                const highlight = document.createElement('div');
                highlight.id = 'bron-highlight';
                Object.assign(highlight.style, {
                    position: 'fixed',
                    top: `${rect.top - 4}px`,
                    left: `${rect.left - 4}px`,
                    width: `${rect.width + 8}px`,
                    height: `${rect.height + 8}px`,
                    border: '2px solid #3b82f6',
                    borderRadius: '6px',
                    boxShadow: '0 0 12px 3px rgba(59,130,246,0.5), 0 0 24px 6px rgba(139,92,246,0.3)',
                    zIndex: '999999',
                    pointerEvents: 'none',
                });
                const ripple = document.createElement('div');
                ripple.id = 'bron-ripple';
                Object.assign(ripple.style, {
                    position: 'fixed',
                    top: `${rect.top + rect.height / 2 - 12}px`,
                    left: `${rect.left + rect.width / 2 - 12}px`,
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: 'rgba(59,130,246,0.6)',
                    zIndex: '999999',
                    pointerEvents: 'none',
                });
                const style = document.createElement('style');
                style.id = 'bron-fx-style';
                style.textContent = [
                    '@keyframes bron-pulse { 0%,100% { box-shadow: 0 0 12px 3px rgba(59,130,246,0.5); } 50% { box-shadow: 0 0 20px 6px rgba(139,92,246,0.7); } }',
                    '@keyframes bron-ripple { 0% { transform: scale(0.5); opacity: 1; } 100% { transform: scale(3); opacity: 0; } }',
                ].join(' ');
                document.getElementById('bron-highlight')?.remove();
                document.getElementById('bron-ripple')?.remove();
                document.getElementById('bron-fx-style')?.remove();
                highlight.style.animation = 'bron-pulse 0.6s ease-in-out 2';
                ripple.style.animation = 'bron-ripple 0.8s ease-out forwards';
                document.body.appendChild(style);
                document.body.appendChild(highlight);
                document.body.appendChild(ripple);
                setTimeout(() => {
                    highlight.remove();
                    ripple.remove();
                    style.remove();
                }, 1500);
            }, selector);
        }
        catch {
            // Ignore visual-only failures.
        }
    }
    // ---------- Browser lifecycle ----------
    async ensureReady() {
        if (this.recovering) {
            await this.recovering;
            return;
        }
        const disconnected = !this.context || !this.contextAlive || (this.browser && !this.browser.isConnected());
        if (disconnected) {
            await this.recoverBrowser('ensure-ready');
        }
    }
    async recoverBrowser(reason, initialUrl) {
        if (this.recovering) {
            await this.recovering;
            return;
        }
        this.recovering = (async () => {
            if (this.shuttingDown)
                return;
            console.warn(`[BrowserController] Recovering browser (${reason})...`);
            await this.teardownBrowser();
            await this.launchBrowserAndRestore(initialUrl);
        })();
        try {
            await this.recovering;
        }
        finally {
            this.recovering = null;
        }
    }
    async launchBrowserAndRestore(initialUrl) {
        const userDataDir = this.getProfileUserDataDir(this.currentProfile);
        fs.mkdirSync(userDataDir, { recursive: true });
        this.clearStaleProfileLocks(userDataDir);
        this.context = await playwright_extra_1.chromium.launchPersistentContext(userDataDir, {
            headless: this.headless,
            viewport: { width: 1440, height: 900 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            bypassCSP: true,
            ignoreHTTPSErrors: true,
            args: [
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-infobars',
                '--window-size=1440,900',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-features=IsolateOrigins,site-per-process,WebAuthentication,WebAuthenticationUI,FedCm,CredentialManagement',
            ],
        });
        await this.context.route('**/*', async (route) => {
            const req = route.request();
            const resourceType = req.resourceType();
            const reqUrl = req.url();
            if (resourceType !== 'document' && this.isBlockedTrackerUrl(reqUrl)) {
                await route.abort();
                return;
            }
            await route.continue();
        });
        this.browser = this.context.browser();
        this.contextAlive = true;
        this.context.on('close', () => {
            this.contextAlive = false;
            if (this.shuttingDown || this.suppressDisconnectRecovery)
                return;
            this.recoverBrowser('context-closed').catch(() => { });
        });
        this.browser?.on('disconnected', () => {
            this.contextAlive = false;
            if (this.shuttingDown || this.suppressDisconnectRecovery)
                return;
            this.recoverBrowser('disconnected-event').catch(() => { });
        });
        this.pages.clear();
        this.activeTabId = null;
        const existingPages = this.context.pages();
        for (const p of existingPages) {
            await p.close().catch(() => { });
        }
        const restored = await this.restoreSessionSnapshot();
        if (!restored) {
            await this.newTab(initialUrl || 'https://www.google.com');
        }
        this.persistSessionSnapshot();
    }
    async teardownBrowser() {
        this.suppressDisconnectRecovery = true;
        try {
            if (this.context)
                await this.context.close().catch(() => { });
            if (this.browser?.isConnected())
                await this.browser.close().catch(() => { });
        }
        finally {
            this.contextAlive = false;
            this.context = null;
            this.browser = null;
            this.pages.clear();
            this.activeTabId = null;
            this.suppressDisconnectRecovery = false;
        }
    }
    async waitForPageSettle(page, mode = 'action') {
        const timeout = mode === 'navigation' ? 5000 : 1800;
        const tailDelay = mode === 'navigation' ? 250 : 80;
        try {
            await page.waitForLoadState('networkidle', { timeout }).catch(() => { });
        }
        catch { }
        await page.waitForTimeout(tailDelay);
    }
    clearStaleProfileLocks(profileDir) {
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'Lockfile', 'lockfile'];
        for (const file of lockFiles) {
            const lockPath = path.join(profileDir, file);
            try {
                if (fs.existsSync(lockPath)) {
                    fs.rmSync(lockPath, { recursive: true, force: true });
                }
            }
            catch {
                // Best effort cleanup.
            }
        }
    }
    // ---------- Persistence ----------
    persistSessionSnapshot() {
        try {
            const tabs = [];
            let activeIndex = 0;
            let index = 0;
            for (const [id, page] of this.pages) {
                let url = 'about:blank';
                try {
                    url = page.url() || 'about:blank';
                }
                catch { }
                const isActive = id === this.activeTabId;
                if (isActive)
                    activeIndex = index;
                tabs.push({ url, active: isActive });
                index++;
            }
            const state = {
                profile: this.currentProfile,
                activeTabIndex: activeIndex,
                tabs,
                savedAt: Date.now(),
            };
            const statePath = this.getProfileStatePath(this.currentProfile);
            fs.mkdirSync(path.dirname(statePath), { recursive: true });
            fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
        }
        catch {
            // Best effort persistence.
        }
    }
    async restoreSessionSnapshot() {
        const statePath = this.getProfileStatePath(this.currentProfile);
        if (!fs.existsSync(statePath))
            return false;
        try {
            const raw = fs.readFileSync(statePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!parsed?.tabs || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0)
                return false;
            const maxTabs = Math.min(parsed.tabs.length, 8);
            for (let i = 0; i < maxTabs; i++) {
                const tab = parsed.tabs[i];
                const url = String(tab.url || '').trim() || 'about:blank';
                const id = await this.newTab(url);
                if (i === parsed.activeTabIndex) {
                    this.activeTabId = id;
                }
            }
            if (!this.activeTabId) {
                const first = Array.from(this.pages.keys())[0];
                this.activeTabId = first || null;
            }
            return this.pages.size > 0;
        }
        catch {
            return false;
        }
    }
    getProfileStatePath(profile) {
        return path.join(electron_1.app.getPath('userData'), 'profiles', profile, 'session-state.json');
    }
    getProfileUserDataDir(profile) {
        return path.join(electron_1.app.getPath('userData'), 'profiles', profile, 'chrome-data');
    }
    normalizeProfileName(input) {
        const clean = String(input || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        return clean || 'default';
    }
    getProfileForUrl(url) {
        try {
            const host = new URL(url).hostname.toLowerCase();
            if (!host)
                return null;
            if (this.domainProfileMap[host])
                return this.domainProfileMap[host];
            const parts = host.split('.');
            for (let i = 1; i < parts.length; i++) {
                const suffix = parts.slice(i).join('.');
                if (this.domainProfileMap[suffix])
                    return this.domainProfileMap[suffix];
            }
            return null;
        }
        catch {
            return null;
        }
    }
    isBlockedTrackerUrl(rawUrl) {
        try {
            const host = new URL(rawUrl).hostname.toLowerCase();
            return TRACKER_HOST_BLOCKLIST.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
        }
        catch {
            return false;
        }
    }
    normalizeCookieForPlaywright(cookie) {
        const name = String(cookie.name || '').trim();
        if (!name)
            return null;
        const value = String(cookie.value ?? '');
        const domain = cookie.domain ? String(cookie.domain).trim() : undefined;
        const pathValue = cookie.path ? String(cookie.path).trim() : '/';
        const url = cookie.url ? String(cookie.url).trim() : undefined;
        if (!url && !domain)
            return null;
        const normalized = {
            name,
            value,
            path: pathValue || '/',
            httpOnly: !!cookie.httpOnly,
            secure: !!cookie.secure,
        };
        if (typeof cookie.expires === 'number' && Number.isFinite(cookie.expires)) {
            normalized.expires = cookie.expires;
        }
        if (cookie.sameSite && ['Strict', 'Lax', 'None'].includes(cookie.sameSite)) {
            normalized.sameSite = cookie.sameSite;
        }
        if (url) {
            normalized.url = url;
        }
        else {
            normalized.domain = domain;
        }
        return normalized;
    }
}
exports.BrowserController = BrowserController;
//# sourceMappingURL=browserController.js.map