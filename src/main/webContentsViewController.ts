import { BrowserWindow, WebContentsView } from 'electron';
import type { AgentAutomationController } from './agentAutomation';
import type { BrowserState, TabGroupInfo, TabInfo } from '../shared/types';
import type { BrowserHostCoordinator } from './browserHost';
import { getAutofillContextForUrl, getSettings, saveSavedCredential } from './memory';
import { DOM_UTILS_SCRIPT } from './domUtils';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as http from 'http';

function getBrowserWebSocketUrl(): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/version', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.webSocketDebuggerUrl) {
            resolve(parsed.webSocketDebuggerUrl);
          } else {
            reject(new Error('webSocketDebuggerUrl not found in json/version response'));
          }
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

type ConsoleLogEntry = { level: string; text: string; timestamp: number };

interface ManagedTab {
  id: string;
  view: WebContentsView;
  title: string;
  url: string;
  initialUrl: string;
  pinned?: boolean;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const CREDENTIAL_MARKER = '__BRON_SAVE_CREDENTIAL__';

export class WebContentsViewController implements AgentAutomationController {
  private readonly tabs = new Map<string, ManagedTab>();
  private readonly consoleLogsByTab = new Map<string, ConsoleLogEntry[]>();
  private readonly tabGroups = new Map<string, TabGroupInfo>();
  private readonly tabGroupAssignments = new Map<string, string>();
  private activeTabId: string | null = null;
  private agentTabId: string | null = null;
  private tabCounter = 0;
  private groupCounter = 0;
  private lastCredentialSaveKey = '';
  private lastElementCoordinates = new Map<string, { x: number; y: number }>();
  private playwrightBrowser: Browser | null = null;
  private playwrightContext: BrowserContext | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly getPartitionForWindow: (windowWebContentsId: number) => string,
    private readonly browserHost: BrowserHostCoordinator,
  ) {
    this.browserHost.onViewportChanged((windowId) => {
      void this.applyActiveViewBounds(windowId);
    });
  }

  private async getPlaywrightPage(tab: ManagedTab): Promise<Page> {
    if (this.playwrightBrowser && !this.playwrightBrowser.isConnected()) {
      this.playwrightBrowser = null;
      this.playwrightContext = null;
    }

    if (!this.playwrightBrowser) {
      let wsUrl: string;
      try {
        wsUrl = await getBrowserWebSocketUrl();
      } catch (err) {
        console.warn('[Playwright Controller] Failed to fetch browser websocket URL, falling back to default HTTP endpoint:', err);
        wsUrl = 'http://127.0.0.1:9222';
      }
      this.playwrightBrowser = await chromium.connectOverCDP(wsUrl, { timeout: 10000 });
      const contexts = this.playwrightBrowser.contexts();
      this.playwrightContext = contexts[0] || null;
    }

    if (!this.playwrightContext) {
      throw new Error('Playwright context not initialized');
    }

    const token = 'bron_tab_' + Math.random().toString(36).slice(2);
    await tab.view.webContents.executeJavaScript(`window.__bron_playwright_token = "${token}"`);

    const pages = this.playwrightContext.pages();
    for (const page of pages) {
      try {
        const pageToken = await page.evaluate(() => (window as any).__bron_playwright_token);
        if (pageToken === token) {
          await page.evaluate(() => { delete (window as any).__bron_playwright_token; });
          return page;
        }
      } catch {}
    }
    
    throw new Error('Could not match active tab to Playwright page');
  }

  getActiveTabId(): string | null {
    return this.agentTabId || this.activeTabId;
  }

  getAgentTabId(): string | null {
    return this.agentTabId;
  }

  setAgentTabId(id: string | null): void {
    this.agentTabId = id || null;
  }

  async getBrowserState(): Promise<BrowserState> {
    await this.ensureBootTab();
    const active = this.getActiveTab();
    if (!active || active.view.webContents.isDestroyed()) {
      return {
        url: '',
        title: '',
        visibleText: '',
        clickableElements: [],
        inputFields: [],
        tabs: this.getTabSnapshot(),
        tabGroups: this.snapshotTabGroups(this.getTabSnapshot()),
      };
    }

    const page = await active.view.webContents.executeJavaScript(
      `(async function(){
        try {
          if (!window.__BRON_VISUAL_MAPPER) return { error: 'Visual mapper not installed' };
          const { buildTreeFromBody, DomUtils } = window.__BRON_VISUAL_MAPPER;

          // now run it
          const [elements, elementTree] = await buildTreeFromBody();

          const clickables = [];
          const inputFields = [];

          let clickableIdx = 0;
          let inputIdx = 0;

          // Skyvern marks elements with unique_id, tagName, text, interactable, etc.
          // and attributes
          
          for (const el of elements) {
            if (!el.interactable) continue;

            const DOMNode = document.querySelector('[unique_id="' + el.id + '"]');
            if (!DOMNode) continue;

            const rect = DomUtils.getVisibleClientRect(DOMNode, true);
            if (!rect) continue;

            const center_x = Math.round(rect.left + rect.width / 2);
            const center_y = Math.round(rect.top + rect.height / 2);

            // Set data properties on DOM Node for injectVisualBadges
            DOMNode.dataset.bronX = center_x;
            DOMNode.dataset.bronY = center_y;
            DOMNode.dataset.bronWidth = rect.width;
            DOMNode.dataset.bronHeight = rect.height;

            const isInput = ['input', 'textarea', 'select'].includes(el.tagName);
            if (isInput) {
              inputIdx++;
              const badge = 'I' + inputIdx;
              DOMNode.dataset.bronBadge = badge;
              inputFields.push({
                placeholder: el.attributes.placeholder || '',
                label: el.attributes['aria-label'] || el.attributes.name || el.text || '',
                type: el.attributes.type || el.tagName,
                selector: '[unique_id="' + el.id + '"]',
                badge: badge,
                x: center_x,
                y: center_y,
                width: rect.width,
                height: rect.height,
              });
            } else {
              clickableIdx++;
              const badge = 'C' + clickableIdx;
              DOMNode.dataset.bronBadge = badge;
              clickables.push({
                text: el.text || el.attributes['aria-label'] || el.attributes.title || '',
                tag: el.tagName,
                role: el.attributes.role,
                selector: '[unique_id="' + el.id + '"]',
                badge: badge,
                x: center_x,
                y: center_y,
                width: rect.width,
                height: rect.height,
              });
            }
          }

          // Cache on window for injectVisualBadges
          window.__BRON_BADGES__ = { clickables, inputFields };

          return {
            url: location.href,
            title: document.title || '',
            visibleText: document.body?.innerText || '',
            clickableElements: clickables.slice(0, 100),
            inputFields: inputFields.slice(0, 40),
            prunedDomTree: JSON.stringify(elementTree, null, 2).slice(0, 50000),
          };

        } catch (e) {
          return {
            url: location.href,
            title: document.title || '',
            visibleText: 'Extraction error: ' + (e?.message || String(e)),
            clickableElements: [],
            inputFields: [],
            prunedDomTree: '',
          };
        }
      })();`,
      true,
    );

    // Save coords for faster and more reliable interactions
    this.lastElementCoordinates.clear();
    if (page?.clickableElements) {
      for (const el of page.clickableElements) {
        this.lastElementCoordinates.set(el.selector, { x: el.x, y: el.y });
      }
    }
    if (page?.inputFields) {
      for (const el of page.inputFields) {
        this.lastElementCoordinates.set(el.selector, { x: el.x, y: el.y });
      }
    }

    const tabs = this.getTabSnapshot();
    return {
      url: page?.url || '',
      title: page?.title || '',
      visibleText: page?.visibleText || page?.error || '',
      clickableElements: page?.clickableElements || [],
      inputFields: page?.inputFields || [],
      prunedDomTree: page?.prunedDomTree || '',
      tabs,
      tabGroups: this.snapshotTabGroups(tabs),
    };
  }

  async getScreenshot(): Promise<string> {
    await this.ensureBootTab();
    const active = this.getActiveTab();
    if (!active || active.view.webContents.isDestroyed()) return '';
    
    // Inject visual index badges before taking screenshot
    await this.injectVisualBadges();
    
    // Short sleep to ensure the page has drawn the badges
    await new Promise((resolve) => setTimeout(resolve, 40));
    
    try {
      const image = await active.view.webContents.capturePage();
      // Clear visual index badges immediately after
      await this.clearVisualBadges();
      return image?.toDataURL ? String(image.toDataURL()) : '';
    } catch {
      await this.clearVisualBadges();
      return '';
    }
  }

  private async injectVisualBadges(): Promise<void> {
    const active = this.getActiveTab();
    if (!active) return;
    try {
      await active.view.webContents.executeJavaScript(`
        (function() {
          try {
            document.getElementById('bron-overlay-container')?.remove();
            
            const badgesData = window.__BRON_BADGES__;
            if (!badgesData) return;
            
            const container = document.createElement('div');
            container.id = 'bron-overlay-container';
            Object.assign(container.style, {
              position: 'fixed',
              top: '0',
              left: '0',
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: '2147483645'
            });
            
            const createBadge = (text, x, y, isInput) => {
              const badge = document.createElement('div');
              badge.innerText = text;
              Object.assign(badge.style, {
                position: 'absolute',
                top: (y - 8) + 'px',
                left: (x - 8) + 'px',
                background: isInput ? 'linear-gradient(135deg, #db2777 0%, #be185d 100%)' : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                color: 'white',
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                fontSize: '9px',
                fontWeight: 'bold',
                padding: '2px 4px',
                borderRadius: '3px',
                border: '1px solid rgba(255,255,255,0.7)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                zIndex: '2147483646',
                pointerEvents: 'none',
                userSelect: 'none',
                lineHeight: '1',
                whiteSpace: 'nowrap'
              });
              return badge;
            };

            for (const el of badgesData.clickables || []) {
              container.appendChild(createBadge(el.badge, el.x, el.y, false));
            }
            
            for (const el of badgesData.inputFields || []) {
              container.appendChild(createBadge(el.badge, el.x, el.y, true));
            }
            
            document.body.appendChild(container);
          } catch (e) {
            console.error('Failed to inject visual badges:', e);
          }
        })();
      `);
    } catch (err) {
      console.error('injectVisualBadges execution failed:', err);
    }
  }

  private async clearVisualBadges(): Promise<void> {
    const active = this.getActiveTab();
    if (!active) return;
    try {
      await active.view.webContents.executeJavaScript(`
        document.getElementById('bron-overlay-container')?.remove();
      `);
    } catch (err) {
      console.error('clearVisualBadges execution failed:', err);
    }
  }


  async getPdfData(): Promise<string> {
    await this.ensureBootTab();
    const active = this.getActiveTab();
    if (!active) return '';
    const pdfData = await active.view.webContents.printToPDF({ printBackground: true });
    const bytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData || []);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      const chunk = bytes.subarray(i, i + 0x8000);
      binary += String.fromCharCode(...chunk);
    }
    return Buffer.from(binary, 'binary').toString('base64');
  }

  async getDom(selector?: string): Promise<string> {
    const active = await this.requireActiveTab();
    const script = !selector
      ? `(function(){ return document.documentElement?.outerHTML || ''; })();`
      : `(function(){ try { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.outerHTML : ''; } catch { return ''; } })();`;
    const html = await active.view.webContents.executeJavaScript(script, true);
    return String(html || '').slice(0, 200000);
  }

  async searchDom(query: string, limit = 25): Promise<string> {
    const active = await this.requireActiveTab();
    const result = await active.view.webContents.executeJavaScript(
      `(function(){
        const rawQuery = ${JSON.stringify(query)};
        const maxResults = ${Math.max(1, Math.min(100, limit))};
        const out = [];
        const push = (selector, text) => {
          if (out.length >= maxResults) return;
          out.push({ selector, text: String(text || '').replace(/\\s+/g, ' ').trim().slice(0, 180) });
        };
        const buildSelector = (el) => {
          const id = el.getAttribute?.('id');
          if (id) return '#' + id;
          const tag = (el.tagName || 'div').toLowerCase();
          const testId = el.getAttribute?.('data-testid') || el.getAttribute?.('data-test-id');
          if (testId) return tag + '[data-testid="' + testId.replace(/"/g, '\\\\\\"') + '"]';
          const aria = el.getAttribute?.('aria-label');
          if (aria) return tag + '[aria-label="' + aria.replace(/"/g, '\\\\\\"') + '"]';
          return tag;
        };
        const q = rawQuery.toLowerCase();
        const nodes = document.querySelectorAll('body *');
        for (const node of nodes) {
          if (out.length >= maxResults) break;
          const text = (node.textContent || '').trim();
          if (!text) continue;
          if (text.toLowerCase().includes(q)) {
            push(buildSelector(node), text);
          }
        }
        return out;
      })();`,
      true,
    );
    if (!Array.isArray(result) || result.length === 0) return `No DOM matches for "${query}"`;
    return result.map((entry: any, idx: number) => `${idx + 1}. ${entry.selector} => ${entry.text}`).join('\n');
  }

  async evaluateScript(script: string): Promise<string> {
    const active = await this.requireActiveTab();
    try {
      const wrappedScript = `(async function __bronEval__() {\n${script}\n})();`;
      const value = await active.view.webContents.executeJavaScript(wrappedScript, true);
      if (value === undefined || value === null) return '';
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    } catch (err: any) {
      return `Script error: ${String(err?.message || err)}`;
    }
  }

  async getConsoleLogs(options?: { clear?: boolean; level?: string; limit?: number; search?: string }): Promise<string> {
    const tabId = this.getActiveTabId() || '';
    let logs = [...(this.consoleLogsByTab.get(tabId) || [])];
    const level = String(options?.level || '').toLowerCase().trim();
    const search = String(options?.search || '').toLowerCase().trim();
    const limit = Math.max(1, Math.min(300, Number(options?.limit || 80)));
    if (level) logs = logs.filter((entry) => entry.level.toLowerCase().includes(level));
    if (search) logs = logs.filter((entry) => entry.text.toLowerCase().includes(search));
    if (options?.clear) this.consoleLogsByTab.set(tabId, []);
    const sliced = logs.slice(-limit);
    if (!sliced.length) return 'No console logs.';
    return sliced.map((entry) => `[${new Date(entry.timestamp).toISOString()}] ${entry.level}: ${entry.text}`).join('\n');
  }

  async navigate(url: string): Promise<void> {
    await this.ensureBootTab();
    const active = this.getActiveTab();
    if (!active) return;
    await this.navigateTab(active, url);
  }

  async goBack(): Promise<void> {
    const active = await this.requireActiveTab();
    if (active.view.webContents.navigationHistory.canGoBack()) {
      active.view.webContents.navigationHistory.goBack();
    }
  }

  async goForward(): Promise<void> {
    const active = await this.requireActiveTab();
    if (active.view.webContents.navigationHistory.canGoForward()) {
      active.view.webContents.navigationHistory.goForward();
    }
  }

  async refresh(): Promise<void> {
    const active = await this.requireActiveTab();
    active.view.webContents.reload();
  }

  async search(query: string): Promise<string> {
    await this.navigate(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    return `Searched Google for: ${query}`;
  }

  async highlightElement(selector: string): Promise<void> {
    const active = await this.requireActiveTab();
    await active.view.webContents.executeJavaScript(
      `(function(){
        const sel = ${JSON.stringify(selector)};
        const el = document.querySelector(sel);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const h = document.createElement('div');
        h.id = 'bron-highlight';
        Object.assign(h.style, {
          position: 'fixed',
          top: (rect.top - 3) + 'px',
          left: (rect.left - 3) + 'px',
          width: (rect.width + 6) + 'px',
          height: (rect.height + 6) + 'px',
          border: '2px solid #3b82f6',
          borderRadius: '8px',
          boxShadow: '0 0 0 2px rgba(59,130,246,0.2)',
          zIndex: '2147483647',
          pointerEvents: 'none'
        });
        document.getElementById('bron-highlight')?.remove();
        document.body.appendChild(h);
        setTimeout(() => h.remove(), 800);
      })();`,
      true,
    );
  }

  async click(selector: string): Promise<string> {
    const coords = this.lastElementCoordinates.get(selector);
    if (coords) {
      return this.clickAt(coords.x, coords.y);
    }
    const active = await this.requireActiveTab();

    try {
      const page = await this.getPlaywrightPage(active);
      await page.click(selector, { timeout: 4000 });
      return `Clicked (playwright): ${selector}`;
    } catch (err) {
      console.warn(`[Playwright Controller] Click failed, falling back: ${err instanceof Error ? err.message : err}`);
      const native = await this.nativeClickSelector(active, selector, 'left');
      if (native !== null) return native;
      return await this.runClickFallback(active, selector, false);
    }
  }

  async clickAt(x: number, y: number): Promise<string> {
    const active = await this.requireActiveTab();
    if (active.view.webContents.isDestroyed()) return 'Action failed: tab was closed';
    
    const valid = await active.view.webContents.executeJavaScript(`
      (function() {
        const el = document.elementFromPoint(${x}, ${y});
        return el && el !== document.body && el !== document.documentElement;
      })()
    `).catch(() => false);
    
    if (!valid) return 'Action failed: target node at coordinates is no longer interactable (stale state).';

    await this.sendNativeMouseEvent(active, { type: 'mouseMove', x, y, button: 'left', clickCount: 0 });
    await this.delay(25);
    await this.sendNativeMouseEvent(active, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await this.delay(20);
    await this.sendNativeMouseEvent(active, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    return `Clicked at ${x}, ${y}`;
  }

  async rightClick(selector: string): Promise<string> {
    const coords = this.lastElementCoordinates.get(selector);
    if (coords) {
      return this.rightClickAt(coords.x, coords.y);
    }
    const active = await this.requireActiveTab();
    // Try native first (coordinate-based via selector lookup), fall back to JS dispatch
    const native = await this.nativeClickSelector(active, selector, 'right');
    if (native !== null) return native;
    return await this.runClickFallback(active, selector, true);
  }

  async rightClickAt(x: number, y: number): Promise<string> {
    const active = await this.requireActiveTab();
    if (active.view.webContents.isDestroyed()) return 'Action failed: tab was closed';
    
    const valid = await active.view.webContents.executeJavaScript(`
      (function() {
        const el = document.elementFromPoint(${x}, ${y});
        return el && el !== document.body && el !== document.documentElement;
      })()
    `).catch(() => false);
    
    if (!valid) return 'Action failed: target node at coordinates is no longer interactable (stale state).';

    await this.sendNativeMouseEvent(active, { type: 'mouseMove', x, y, button: 'right', clickCount: 0 });
    await this.delay(25);
    await this.sendNativeMouseEvent(active, { type: 'mouseDown', x, y, button: 'right', clickCount: 1 });
    await this.delay(35);
    await this.sendNativeMouseEvent(active, { type: 'mouseUp', x, y, button: 'right', clickCount: 1 });
    await this.sendNativeMouseEvent(active, { type: 'contextMenu', x, y, button: 'right', clickCount: 1 });
    return `Right-clicked at ${x}, ${y}`;
  }

  async selectOption(selector: string, value: string): Promise<string> {
    const active = await this.requireActiveTab();
    return await active.view.webContents.executeJavaScript(
      `(function(){
        const sel = ${JSON.stringify(selector)};
        const val = ${JSON.stringify(value)};
        const el = document.querySelector(sel);
        if (!(el instanceof HTMLSelectElement)) return 'Select failed: target is not <select>';
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'Selected "' + val + '" in ' + sel;
      })();`,
      true,
    );
  }

  async check(selector: string): Promise<string> {
    return this.setCheckedState(selector, true);
  }

  async uncheck(selector: string): Promise<string> {
    return this.setCheckedState(selector, false);
  }

  async typeText(selector: string, text: string): Promise<string> {
    const coords = this.lastElementCoordinates.get(selector);
    if (coords) {
      await this.clickAt(coords.x, coords.y);
    }
    const active = await this.requireActiveTab();

    try {
      const page = await this.getPlaywrightPage(active);
      await page.fill(selector, text, { timeout: 4000 });
      return `Typed into (playwright) ${selector}`;
    } catch (err) {
      console.warn(`[Playwright Controller] Fill failed, falling back: ${err instanceof Error ? err.message : err}`);
      const focused = await active.view.webContents.executeJavaScript(
        `(function(){
          try {
            const sel = ${JSON.stringify(selector)};
            const isVisible = (el) => {
              if (!(el instanceof HTMLElement)) return false;
              const rect = el.getBoundingClientRect();
              if (rect.width < 4 || rect.height < 4) return false;
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            };
            const interactiveSelector = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], [tabindex]:not([tabindex="-1"]), [aria-label], [data-testid], [data-test-id], [jsaction], [onclick], input, textarea, [contenteditable="true"]';
            const escapeRegExp = (input) => {
              const special = '\\\\^$.*+?()[]{}|';
              let out = '';
              for (const ch of String(input || '')) out += special.includes(ch) ? ('\\\\\\\\' + ch) : ch;
              return out;
            };
            const findByText = (needle) => {
              const all = Array.from(document.querySelectorAll(interactiveSelector + ', div, span, li'));
              const pattern = new RegExp(escapeRegExp(String(needle || '').toLowerCase().trim()));
              for (const el of all) {
                if (!isVisible(el)) continue;
                const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).replace(/\\s+/g, ' ').trim();
                if (!text) continue;
                if (pattern.test(text.toLowerCase())) return el.closest(interactiveSelector) || el;
              }
              return null;
            };
            let el = null;
            try { el = document.querySelector(sel); } catch {}
            if (!el && sel.startsWith('text=')) {
              const raw = sel.slice(5).replace(/^['"]|['"]$/g, '').trim();
              if (raw) el = findByText(raw);
            }
            if (!el) {
              const hasTextMatch = sel.match(/:has-text\\((['"])(.*?)\\1\\)/i);
              if (hasTextMatch?.[2]) el = findByText(hasTextMatch[2]);
            }
            if (!el) {
              const containsMatch = sel.match(/:contains\\((['"])(.*?)\\1\\)/i);
              if (containsMatch?.[2]) el = findByText(containsMatch[2]);
            }
            if (!el) return false;
            if (typeof el.focus === 'function') {
              el.focus();
              if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                el.select();
              } else if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
                const range = document.createRange();
                range.selectNodeContents(el);
                const sel = window.getSelection();
                if (sel) {
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
              }
              return true;
            }
            return false;
          } catch (e) {
            return false;
          }
        })()`,
        true,
      );
      if (!focused) {
        return `Type failed: target element not found or not focusable: ${selector}`;
      }
      active.view.webContents.focus();
      await active.view.webContents.insertText(text);
      
      await active.view.webContents.executeJavaScript(
        `(function(){
          try {
            const el = document.activeElement;
            if (el) {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
            }
          } catch (e) {}
        })()`,
        true,
      ).catch(() => {});
      return `Typed into ${selector}`;
    }
  }

  async uploadFiles(
    selector: string,
    files: Array<{ path: string; name: string; mimeType: string; data: string }>,
  ): Promise<string> {
    const active = await this.requireActiveTab();
    return await active.view.webContents.executeJavaScript(
      `(async function(){
        try {
          const sel = ${JSON.stringify(selector)};
          const rawFiles = ${JSON.stringify(files)};
          let el = document.querySelector(sel);
          if (el instanceof HTMLLabelElement) el = el.querySelector('input[type="file"]');
          if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
            const nested = el instanceof Element ? el.querySelector('input[type="file"]') : null;
            if (nested instanceof HTMLInputElement) el = nested;
          }
          if (!(el instanceof HTMLInputElement) || el.type !== 'file') return 'Upload failed: target is not a file input';
          const decodeBase64 = (data) => {
            const binary = atob(String(data || ''));
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes;
          };
          const transfer = new DataTransfer();
          for (const file of rawFiles) {
            const bytes = decodeBase64(file.data);
            const blob = new Blob([bytes], { type: file.mimeType || 'application/octet-stream' });
            transfer.items.add(new File([blob], file.name || 'upload.bin', { type: file.mimeType || 'application/octet-stream' }));
          }
          el.files = transfer.files;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return 'Uploaded ' + transfer.files.length + ' file(s) to ' + sel;
        } catch (e) {
          return 'Upload failed: ' + (e?.message || String(e));
        }
      })();`,
      true,
    );
  }

  async pressEnter(): Promise<string> {
    const active = await this.requireActiveTab();
    try {
      const page = await this.getPlaywrightPage(active);
      await page.keyboard.press('Enter');
      return 'Pressed Enter (playwright)';
    } catch (err) {
      console.warn(`[Playwright Controller] pressEnter failed, falling back: ${err instanceof Error ? err.message : err}`);
      active.view.webContents.focus();
      active.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      await this.delay(20);
      active.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      return 'Pressed Enter';
    }
  }

  async pressKey(key: string): Promise<string> {
    const active = await this.requireActiveTab();
    try {
      const page = await this.getPlaywrightPage(active);
      await page.keyboard.press(key);
      return `Pressed key (playwright): ${key}`;
    } catch (err) {
      console.warn(`[Playwright Controller] pressKey failed, falling back: ${err instanceof Error ? err.message : err}`);
      active.view.webContents.focus();
      active.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
      await this.delay(20);
      active.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
      return `Pressed key: ${key}`;
    }
  }

  async focus(selector: string): Promise<string> {
    const active = await this.requireActiveTab();
    return await active.view.webContents.executeJavaScript(
      `(function(){
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'Focus failed: element not found';
        if (el instanceof HTMLElement) el.focus();
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        return 'Focused ' + ${JSON.stringify(selector)};
      })();`,
      true,
    );
  }

  async hover(selector: string): Promise<string> {
    const coords = this.lastElementCoordinates.get(selector);
    if (coords) {
      return this.hoverAt(coords.x, coords.y);
    }
    const active = await this.requireActiveTab();
    const point = await this.computePointForSelector(active, selector);
    if (point) {
      await this.sendNativeMouseEvent(active, { type: 'mouseMove', x: point.x, y: point.y, button: 'left', clickCount: 0 });
      return `Hovered ${selector}`;
    }
    return `Hover failed: element not found`;
  }

  async hoverAt(x: number, y: number): Promise<string> {
    const active = await this.requireActiveTab();
    if (active.view.webContents.isDestroyed()) return 'Action failed: tab was closed';
    
    const valid = await active.view.webContents.executeJavaScript(`
      (function() {
        const el = document.elementFromPoint(${x}, ${y});
        return el && el !== document.body && el !== document.documentElement;
      })()
    `).catch(() => false);
    
    if (!valid) return 'Action failed: target node at coordinates is no longer interactable (stale state).';

    await this.sendNativeMouseEvent(active, { type: 'mouseMove', x, y, button: 'left', clickCount: 0 });
    return `Hovered at ${x}, ${y}`;
  }

  async adjustZoom(delta: number): Promise<number> {
    const active = await this.requireActiveTab();
    const current = active.view.webContents.getZoomFactor();
    const next = Math.max(0.25, Math.min(5, current + Number(delta || 0)));
    active.view.webContents.setZoomFactor(next);
    return next;
  }

  async scroll(direction: string): Promise<string> {
    const active = await this.requireActiveTab();
    const delta = String(direction || 'down').toLowerCase() === 'up' ? -500 : 500;
    await active.view.webContents.executeJavaScript(`window.scrollBy({ top: ${delta}, behavior: 'instant' });`, true);
    return `Scrolled ${delta < 0 ? 'up' : 'down'}`;
  }

  async drag(sourceSelector: string, targetSelector: string): Promise<string> {
    const active = await this.requireActiveTab();
    try {
      const page = await this.getPlaywrightPage(active);
      await page.dragAndDrop(sourceSelector, targetSelector, { timeout: 4000 });
      return `Dragged (playwright) ${sourceSelector} to ${targetSelector}`;
    } catch (err) {
      console.warn(`[Playwright Controller] Drag failed, falling back: ${err instanceof Error ? err.message : err}`);
      return await active.view.webContents.executeJavaScript(
        `(function(){
          const src = document.querySelector(${JSON.stringify(sourceSelector)});
          const dst = document.querySelector(${JSON.stringify(targetSelector)});
          if (!src || !dst) return 'Drag failed: missing source or target';
          const srcRect = src.getBoundingClientRect();
          const dstRect = dst.getBoundingClientRect();
          src.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: srcRect.left + srcRect.width / 2, clientY: srcRect.top + srcRect.height / 2 }));
          dst.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: dstRect.left + dstRect.width / 2, clientY: dstRect.top + dstRect.height / 2 }));
          dst.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: dstRect.left + dstRect.width / 2, clientY: dstRect.top + dstRect.height / 2 }));
          return 'Dragged ${sourceSelector} to ${targetSelector}';
        })();`,
        true,
      );
    }
  }

  async dragAt(sourceSelector: string, x: number, y: number): Promise<string> {
    const active = await this.requireActiveTab();
    try {
      const page = await this.getPlaywrightPage(active);
      const el = page.locator(sourceSelector);
      const box = await el.boundingBox();
      if (!box) throw new Error('Source selector has no bounding box');
      
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 5 });
      await page.mouse.up();
      return `Dragged (playwright) ${sourceSelector} to ${x}, ${y}`;
    } catch (err) {
      console.warn(`[Playwright Controller] dragAt failed, falling back: ${err instanceof Error ? err.message : err}`);
      return await active.view.webContents.executeJavaScript(
        `(function(){
          const src = document.querySelector(${JSON.stringify(sourceSelector)});
          if (!src) return 'DragAt failed: missing source selector';
          src.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          src.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} }));
          src.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} }));
          return 'Dragged ${sourceSelector} to ${x}, ${y}';
        })();`,
        true,
      );
    }
  }

  async newTab(url?: string): Promise<string> {
    const win = this.requireWindow();
    const partition = this.getPartitionForWindow(win.webContents.id);
    const tab = this.createTab(partition, url || 'https://www.google.com/');
    this.activeTabId = tab.id;
    if (!this.agentTabId) this.agentTabId = tab.id;
    await this.showActiveTab();
    this.emitTabUpdate();
    return tab.id;
  }

  async switchTab(tabId: string): Promise<void> {
    await this.ensureBootTab();
    if (!this.tabs.has(tabId)) return;
    this.activeTabId = tabId;
    if (this.agentTabId) this.agentTabId = tabId;
    await this.showActiveTab();
    this.emitTabUpdate();
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const win = this.getWindow();
    if (win && typeof (win.contentView as any).removeChildView === 'function') {
      try { (win.contentView as any).removeChildView(tab.view); } catch {}
    }
    tab.view.webContents.close({ waitForBeforeUnload: false });
    this.tabs.delete(tabId);
    this.consoleLogsByTab.delete(tabId);
    this.forgetTab(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs.keys().next().value || null;
    }
    if (this.agentTabId === tabId) {
      this.agentTabId = this.activeTabId;
    }
    await this.showActiveTab();
    this.emitTabUpdate();
  }

  async getTabs(): Promise<TabInfo[]> {
    await this.ensureBootTab();
    return this.getTabSnapshot();
  }

  async listTabGroups(): Promise<TabGroupInfo[]> {
    const tabs = await this.getTabs();
    return this.snapshotTabGroups(tabs);
  }

  async groupTabs(tabIds: string[], options?: { id?: string; title?: string; color?: string }): Promise<TabGroupInfo> {
    const tabs = await this.getTabs();
    const validIds = Array.from(new Set(tabIds.filter((id) => tabs.some((tab) => tab.id === id))));
    if (validIds.length === 0) throw new Error('No valid tabs provided for grouping');
    const groupId = String(options?.id || '').trim() || `group_${++this.groupCounter}_${Date.now()}`;
    const existing = this.tabGroups.get(groupId);
    const nextTabIds = Array.from(new Set([...(existing?.tabIds || []), ...validIds]));
    for (const tabId of validIds) {
      const prior = this.tabGroupAssignments.get(tabId);
      if (prior && prior !== groupId) this.removeTabsFromGroup(prior, [tabId]);
      this.tabGroupAssignments.set(tabId, groupId);
    }
    const group: TabGroupInfo = {
      id: groupId,
      title: String(options?.title || existing?.title || `Group ${this.tabGroups.size + 1}`).trim(),
      color: String(options?.color || existing?.color || '').trim() || undefined,
      tabIds: nextTabIds,
    };
    this.tabGroups.set(groupId, group);
    return group;
  }

  async updateTabGroup(groupId: string, updates: { title?: string; color?: string }): Promise<TabGroupInfo | null> {
    const existing = this.tabGroups.get(groupId);
    if (!existing) return null;
    const next = {
      ...existing,
      title: String(updates.title || existing.title || '').trim() || existing.title,
      color: String(updates.color || existing.color || '').trim() || undefined,
    };
    this.tabGroups.set(groupId, next);
    return next;
  }

  async ungroupTabs(tabIds?: string[], groupId?: string): Promise<number> {
    if (groupId) {
      const group = this.tabGroups.get(groupId);
      if (!group) return 0;
      const count = group.tabIds.length;
      this.removeTabsFromGroup(groupId, [...group.tabIds]);
      return count;
    }
    const uniqueIds = Array.from(new Set((tabIds || []).filter(Boolean)));
    let removed = 0;
    for (const tabId of uniqueIds) {
      const assigned = this.tabGroupAssignments.get(tabId);
      if (!assigned) continue;
      this.removeTabsFromGroup(assigned, [tabId]);
      removed += 1;
    }
    return removed;
  }

  async closeTabGroup(groupId: string): Promise<number> {
    const group = this.tabGroups.get(groupId);
    if (!group) return 0;
    const ids = [...group.tabIds];
    for (const tabId of ids) await this.closeTab(tabId);
    this.tabGroups.delete(groupId);
    return ids.length;
  }

  async handleViewportChanged(windowWebContentsId: number): Promise<void> {
    await this.applyActiveViewBounds(windowWebContentsId);
  }

  private requireWindow(): BrowserWindow {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) throw new Error('Renderer window unavailable');
    return win;
  }

  private getActiveTab(): ManagedTab | null {
    const activeId = this.getActiveTabId() || this.activeTabId;
    if (!activeId) return null;
    return this.tabs.get(activeId) || null;
  }

  private async requireActiveTab(): Promise<ManagedTab> {
    await this.ensureBootTab();
    const active = this.getActiveTab();
    if (!active) throw new Error('No active tab available');
    if (active.view.webContents.isDestroyed()) {
      throw new Error('Active tab webContents is destroyed');
    }
    return active;
  }

  private async ensureBootTab(): Promise<void> {
    if (this.tabs.size > 0) return;
    const win = this.requireWindow();
    const partition = this.getPartitionForWindow(win.webContents.id);
    const tab = this.createTab(partition, 'https://www.google.com/');
    this.activeTabId = tab.id;
    await this.showActiveTab();
    this.emitTabUpdate();
  }

  private createTab(partition: string, initialUrl: string): ManagedTab {
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    view.webContents.setUserAgent(USER_AGENT);
    // Grant clipboard and notification permissions so the page can copy/paste
    // and fire desktop alerts without the agent hitting security denials.
    const ses = view.webContents.session;
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      const allowed = new Set([
        'clipboard-read',
        'clipboard-write',
        'clipboard-sanitized-write',
        'notifications',
        'media',
        'pointerLock',
      ]);
      callback(allowed.has(permission));
    });
    ses.setPermissionCheckHandler((_wc, permission) => {
      const allowed = new Set([
        'clipboard-read',
        'clipboard-write',
        'clipboard-sanitized-write',
        'notifications',
      ]);
      return allowed.has(permission);
    });
    const id = `tab_${++this.tabCounter}_${Date.now()}`;
    const tab: ManagedTab = {
      id,
      view,
      title: this.buildTabTitle(initialUrl),
      url: initialUrl,
      initialUrl,
    };
    this.tabs.set(id, tab);
    this.consoleLogsByTab.set(id, []);
    this.attachTabLifecycle(tab);
    void this.navigateTab(tab, initialUrl);
    return tab;
  }

  private attachTabLifecycle(tab: ManagedTab): void {
    const wc = tab.view.webContents;
    wc.on('page-title-updated', (_event, title) => {
      tab.title = String(title || tab.title || '');
      this.emitTabUpdate();
    });
    const updateUrl = () => {
      tab.url = wc.getURL() || tab.url;
      tab.title = wc.getTitle() || this.buildTabTitle(tab.url);
      this.emitTabUpdate();
    };
    wc.on('did-navigate', updateUrl);
    wc.on('did-navigate-in-page', updateUrl);
    wc.on('did-stop-loading', updateUrl);
    wc.on('dom-ready', () => {
      void this.installPageEnhancements(tab);
    });
    wc.on('console-message', (_event: any, level: number, message: string) => {
      const text = String(message || '');
      if (this.handleCredentialConsoleMessage(text)) {
        return;
      }
      const logs = this.consoleLogsByTab.get(tab.id) || [];
      logs.push({ level: String(level), text, timestamp: Date.now() });
      if (logs.length > 500) logs.shift();
      this.consoleLogsByTab.set(tab.id, logs);
    });
    wc.setWindowOpenHandler(({ url }) => {
      void this.newTab(url);
      return { action: 'deny' };
    });
  }

  private async navigateTab(tab: ManagedTab, rawUrl: string): Promise<void> {
    let target = String(rawUrl || '').trim();
    if (!/^https?:\/\//i.test(target) && !target.startsWith('about:')) {
      if (target.includes('.') && !target.includes(' ')) target = `https://${target}`;
      else target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
    }
    tab.url = target;
    tab.title = this.buildTabTitle(target);
    // Clear stale element coordinates from the previous page to prevent phantom clicks
    this.lastElementCoordinates.clear();
    this.emitTabUpdate();
    await tab.view.webContents.loadURL(target);
  }

  private async installPageEnhancements(tab: ManagedTab): Promise<void> {
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) return;
    try {
      await wc.executeJavaScript(
        `(function() {
          try {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          } catch {}
          if (!window.__BRON_VISUAL_MAPPER) {
            try {
              (function() {
                ${DOM_UTILS_SCRIPT}
                window.__BRON_VISUAL_MAPPER = {
                  buildTreeFromBody: typeof buildTreeFromBody !== 'undefined' ? buildTreeFromBody : null,
                  DomUtils: typeof DomUtils !== 'undefined' ? DomUtils : null
                };
              })();
            } catch (e) {
              console.error('Failed to inject visual mapper:', e);
            }
          }
        })();`,
        true,
      );
    } catch {}

    try {
      const context = getAutofillContextForUrl(tab.url);
      await wc.executeJavaScript(this.buildAutofillScript(context), true);
    } catch {}

    try {
      await wc.executeJavaScript(this.buildCredentialWatcherScript(), true);
    } catch {}
  }

  private handleCredentialConsoleMessage(message: string): boolean {
    if (!message.startsWith(CREDENTIAL_MARKER)) return false;
    try {
      const settings = getSettings();
      if (settings.autoSaveSignIns === false) return true;
      const payload = JSON.parse(message.slice(CREDENTIAL_MARKER.length) || '{}');
      const domain = String(payload?.domain || '').trim();
      const username = String(payload?.username || '').trim();
      const password = String(payload?.password || '');
      const saveKey = `${domain}|${username}|${password}`;
      if (!domain || !password || saveKey === this.lastCredentialSaveKey) return true;
      this.lastCredentialSaveKey = saveKey;
      saveSavedCredential({
        domain,
        username,
        password,
        notes: 'Auto-saved from detected browser sign-in',
      });
    } catch {
      // Ignore malformed internal credential events.
    }
    return true;
  }

  private buildAutofillScript(context: ReturnType<typeof getAutofillContextForUrl>): string {
    return `
      (function() {
        const ctx = ${JSON.stringify(context || {})};
        window.__bronAutofillContext = ctx;

        function setValue(el, value) {
          if (!el || value == null || value === '') return false;
          const proto = el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement && window.HTMLInputElement.prototype;
          const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
          if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(el, String(value));
          else el.value = String(value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }

        function signature(el) {
          const label = el.labels && el.labels.length ? Array.from(el.labels).map((node) => node.textContent || '').join(' ') : '';
          return [
            el.name || '',
            el.id || '',
            el.type || '',
            el.autocomplete || '',
            el.placeholder || '',
            el.getAttribute('aria-label') || '',
            label,
          ].join(' ').toLowerCase();
        }

        function splitName(fullName) {
          const parts = String(fullName || '').trim().split(/\\s+/).filter(Boolean);
          return { first: parts[0] || '', last: parts.length > 1 ? parts.slice(1).join(' ') : '' };
        }

        function fieldValueForSignature(sig) {
          const profile = ctx.profile || {};
          const names = splitName(profile.full_name || '');
          if ((/otp|one.?time|verification|auth|2fa|two.?factor|security code|passcode/.test(sig))) return '';
          if ((/password/.test(sig)) && ctx.credential && ctx.credential.password) return ctx.credential.password;
          if ((/email|e-mail/.test(sig)) && (ctx.credential?.username || profile.email)) return ctx.credential?.username || profile.email;
          if ((/user|login|username/.test(sig)) && ctx.credential?.username) return ctx.credential.username;
          if ((/first/.test(sig) && /name/.test(sig)) && names.first) return names.first;
          if ((/last|family|surname/.test(sig) && /name/.test(sig)) && names.last) return names.last;
          if ((/full.?name|your name|contact name|name/.test(sig)) && profile.full_name) return profile.full_name;
          if ((/phone|mobile|tel/.test(sig)) && profile.phone) return profile.phone;
          if ((/company|organisation|organization/.test(sig)) && profile.company) return profile.company;
          if ((/address.?line.?1|street|address[^2]/.test(sig)) && profile.address_line1) return profile.address_line1;
          if ((/address.?line.?2|apartment|suite|unit/.test(sig)) && profile.address_line2) return profile.address_line2;
          if ((/city|town/.test(sig)) && profile.city) return profile.city;
          if ((/state|province|region/.test(sig)) && profile.state) return profile.state;
          if ((/zip|postal/.test(sig)) && profile.postal_code) return profile.postal_code;
          if ((/country/.test(sig)) && profile.country) return profile.country;
          return '';
        }

        function fillElement(el) {
          if (!el || el.disabled || el.readOnly) return false;
          if ((el.value || '').trim()) return false;
          const sig = signature(el);
          const value = fieldValueForSignature(sig);
          if (!value) return false;
          if (el.tagName === 'SELECT') {
            const option = Array.from(el.options || []).find((opt) => {
              const text = String(opt.textContent || '').trim().toLowerCase();
              const val = String(opt.value || '').trim().toLowerCase();
              const desired = String(value).trim().toLowerCase();
              return text === desired || val === desired;
            });
            if (option) {
              el.value = option.value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            return false;
          }
          return setValue(el, value);
        }

        function applyAll() {
          const fields = Array.from(document.querySelectorAll('input, textarea, select'));
          fields.forEach((el) => fillElement(el));
        }

        document.addEventListener('focusin', function(event) {
          const target = event.target;
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
            fillElement(target);
          }
        }, true);

        applyAll();
      })();
    `;
  }

  private buildCredentialWatcherScript(): string {
    return `
      (function() {
        if (window.__bronCredentialWatcherInstalled) return;
        window.__bronCredentialWatcherInstalled = true;
        const marker = ${JSON.stringify(CREDENTIAL_MARKER)};

        function isVisible(el) {
          if (!(el instanceof HTMLElement)) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }

        function getCandidateFields(form) {
          const fields = Array.from(form.querySelectorAll('input'));
          const usernameField = fields.find((field) => {
            const sig = [field.name, field.id, field.type, field.placeholder, field.autocomplete, field.getAttribute('aria-label')].join(' ').toLowerCase();
            return /email|e-mail|user|login|identifier|phone/.test(sig) && field.type !== 'password' && isVisible(field);
          });
          const passwordField = fields.find((field) => field instanceof HTMLInputElement && field.type === 'password' && isVisible(field));
          return { usernameField, passwordField };
        }

        function emitCredential(form) {
          if (!(form instanceof HTMLFormElement)) return;
          const fields = getCandidateFields(form);
          const username = fields.usernameField instanceof HTMLInputElement ? String(fields.usernameField.value || '').trim() : '';
          const password = fields.passwordField instanceof HTMLInputElement ? String(fields.passwordField.value || '') : '';
          if (!password || password.length < 4) return;
          if (!username && !(fields.passwordField && form.querySelector('input[type="email"], input[name*="email" i]'))) return;
          const payload = { domain: location.hostname, username, password };
          const key = payload.domain + '|' + payload.username + '|' + payload.password;
          if (window.__bronLastCredentialEmit === key) return;
          window.__bronLastCredentialEmit = key;
          console.info(marker + JSON.stringify(payload));
        }

        document.addEventListener('submit', function(event) {
          const form = event.target;
          if (form instanceof HTMLFormElement) window.setTimeout(() => emitCredential(form), 60);
        }, true);

        document.addEventListener('click', function(event) {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const button = target.closest('button, input[type="submit"], [role="button"]');
          if (!button) return;
          const form = button instanceof HTMLInputElement || button instanceof HTMLButtonElement
            ? button.form
            : button.closest('form');
          if (form instanceof HTMLFormElement) window.setTimeout(() => emitCredential(form), 60);
        }, true);
      })();
    `;
  }

  private getTabSnapshot(): TabInfo[] {
    const tabs = Array.from(this.tabs.values()).map((tab) => ({
      id: tab.id,
      title: tab.title || this.buildTabTitle(tab.url),
      url: tab.url,
      initialUrl: tab.initialUrl,
      active: tab.id === this.activeTabId,
      pinned: !!tab.pinned,
      groupId: this.tabGroupAssignments.get(tab.id),
    }));
    return this.decorateTabsWithGroups(tabs);
  }

  private decorateTabsWithGroups(tabs: TabInfo[]): TabInfo[] {
    this.cleanupGroups(tabs);
    return tabs.map((tab) => ({ ...tab, groupId: this.tabGroupAssignments.get(tab.id) }));
  }

  private snapshotTabGroups(tabs: TabInfo[]): TabGroupInfo[] {
    this.cleanupGroups(tabs);
    return Array.from(this.tabGroups.values()).map((group) => ({
      ...group,
      tabIds: group.tabIds.filter((tabId) => tabs.some((tab) => tab.id === tabId)),
    }));
  }

  private cleanupGroups(tabs: TabInfo[]): void {
    const validIds = new Set(tabs.map((tab) => tab.id));
    for (const [tabId, groupId] of Array.from(this.tabGroupAssignments.entries())) {
      if (!validIds.has(tabId)) this.tabGroupAssignments.delete(tabId);
      const group = this.tabGroups.get(groupId);
      if (!group) this.tabGroupAssignments.delete(tabId);
    }
    for (const [groupId, group] of Array.from(this.tabGroups.entries())) {
      const tabIds = group.tabIds.filter((id) => validIds.has(id));
      if (!tabIds.length) this.tabGroups.delete(groupId);
      else if (tabIds.length !== group.tabIds.length) this.tabGroups.set(groupId, { ...group, tabIds });
    }
  }

  private forgetTab(tabId: string): void {
    const groupId = this.tabGroupAssignments.get(tabId);
    if (!groupId) return;
    this.tabGroupAssignments.delete(tabId);
    const group = this.tabGroups.get(groupId);
    if (!group) return;
    const nextIds = group.tabIds.filter((id) => id !== tabId);
    if (!nextIds.length) this.tabGroups.delete(groupId);
    else this.tabGroups.set(groupId, { ...group, tabIds: nextIds });
  }

  private removeTabsFromGroup(groupId: string, tabIds: string[]): void {
    const existing = this.tabGroups.get(groupId);
    if (!existing) return;
    const nextIds = existing.tabIds.filter((id) => !tabIds.includes(id));
    for (const tabId of tabIds) {
      if (this.tabGroupAssignments.get(tabId) === groupId) this.tabGroupAssignments.delete(tabId);
    }
    if (!nextIds.length) this.tabGroups.delete(groupId);
    else this.tabGroups.set(groupId, { ...existing, tabIds: nextIds });
  }

  private buildTabTitle(url: string): string {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  }

  private emitTabUpdate(): void {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('status:tabUpdated', this.getTabSnapshot());
  }

  private async showActiveTab(): Promise<void> {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    const active = this.getActiveTab();
    for (const tab of this.tabs.values()) {
      if (tab.id === active?.id) continue;
      try {
        if (typeof (win.contentView as any).removeChildView === 'function') {
          (win.contentView as any).removeChildView(tab.view);
        }
      } catch {}
      try {
        tab.view.setBounds({ x: -9999, y: -9999, width: 0, height: 0 });
      } catch {}
    }
    if (!active) return;
    try {
      if (typeof (win.contentView as any).addChildView === 'function') {
        (win.contentView as any).addChildView(active.view);
      }
    } catch {}
    await this.applyActiveViewBounds(win.webContents.id);
    active.view.webContents.focus();
  }

  private async applyActiveViewBounds(windowWebContentsId: number): Promise<void> {
    const win = this.getWindow();
    if (!win || win.isDestroyed() || win.webContents.id !== windowWebContentsId) return;
    const active = this.getActiveTab();
    if (!active) return;
    const viewport = this.browserHost.getViewport(windowWebContentsId);
    if (!viewport) return;
    active.view.setBounds({
      x: viewport.x,
      y: viewport.y,
      width: viewport.width,
      height: viewport.height,
    });
  }

  private async computePointForSelector(tab: ManagedTab, selector: string): Promise<{ x: number; y: number; label: string } | null> {
    try {
      const point = await tab.view.webContents.executeJavaScript(
        `(function(){
          try {
            const sel = ${JSON.stringify(selector)};
            const isVisible = (el) => {
              if (!(el instanceof HTMLElement)) return false;
              const rect = el.getBoundingClientRect();
              if (rect.width < 4 || rect.height < 4) return false;
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            };
            const interactiveSelector = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], [tabindex]:not([tabindex="-1"]), [aria-label], [data-testid], [data-test-id], [jsaction], [onclick]';
            const escapeRegExp = (input) => {
              const special = '\\\\^$.*+?()[]{}|';
              let out = '';
              for (const ch of String(input || '')) out += special.includes(ch) ? ('\\\\\\\\' + ch) : ch;
              return out;
            };
            const findByText = (needle) => {
              const all = Array.from(document.querySelectorAll(interactiveSelector + ', div, span, li'));
              const pattern = new RegExp(escapeRegExp(String(needle || '').toLowerCase().trim()));
              for (const el of all) {
                if (!isVisible(el)) continue;
                const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).replace(/\\s+/g, ' ').trim();
                if (!text) continue;
                if (pattern.test(text.toLowerCase())) return el.closest(interactiveSelector) || el;
              }
              return null;
            };
            let el = null;
            try { el = document.querySelector(sel); } catch {}
            if (!el && sel.startsWith('text=')) {
              const raw = sel.slice(5).replace(/^['"]|['"]$/g, '').trim();
              if (raw) el = findByText(raw);
            }
            if (!el) {
              const hasTextMatch = sel.match(/:has-text\\((['"])(.*?)\\1\\)/i);
              if (hasTextMatch?.[2]) el = findByText(hasTextMatch[2]);
            }
            if (!el) {
              const containsMatch = sel.match(/:contains\\((['"])(.*?)\\1\\)/i);
              if (containsMatch?.[2]) el = findByText(containsMatch[2]);
            }
            if (!el) return null;
            const rectBefore = el.getBoundingClientRect();
            const isInViewport = rectBefore.top >= 0 && rectBefore.left >= 0 && rectBefore.bottom <= window.innerHeight && rectBefore.right <= window.innerWidth;
            if (!isInViewport && el instanceof HTMLElement) {
              el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
            }
            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) return null;
            return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), label: sel };
          } catch {
            return null;
          }
        })();`,
        true,
      );
      return point && typeof point.x === 'number' && typeof point.y === 'number' ? point : null;
    } catch {
      return null;
    }
  }

  private async sendNativeMouseEvent(
    tab: ManagedTab,
    event: { type: 'mouseMove' | 'mouseDown' | 'mouseUp' | 'contextMenu'; x: number; y: number; button?: 'left' | 'right' | 'middle'; clickCount?: number },
  ): Promise<void> {
    tab.view.webContents.focus();
    (tab.view.webContents as any).sendInputEvent(event);
  }

  private async nativeClickSelector(tab: ManagedTab, selector: string, button: 'left' | 'right'): Promise<string | null> {
    const point = await this.computePointForSelector(tab, selector);
    if (!point) return null;
    await this.sendNativeMouseEvent(tab, { type: 'mouseMove', x: point.x, y: point.y, button, clickCount: 0 });
    await this.delay(25);
    await this.sendNativeMouseEvent(tab, { type: 'mouseDown', x: point.x, y: point.y, button, clickCount: 1 });
    await this.delay(button === 'right' ? 35 : 20);
    await this.sendNativeMouseEvent(tab, { type: 'mouseUp', x: point.x, y: point.y, button, clickCount: 1 });
    if (button === 'right') {
      await this.sendNativeMouseEvent(tab, { type: 'contextMenu', x: point.x, y: point.y, button, clickCount: 1 });
    }
    return `Clicked (native ${button}): ${point.label}`;
  }

  private async runClickFallback(tab: ManagedTab, selector: string, right: boolean): Promise<string> {
    const eventName = right ? 'contextmenu' : 'click';
    try {
      const result = await tab.view.webContents.executeJavaScript(
        `(function(){
          try {
            const sel = ${JSON.stringify(selector)};
            const isVisible = (el) => {
              if (!(el instanceof HTMLElement)) return false;
              const rect = el.getBoundingClientRect();
              if (rect.width < 4 || rect.height < 4) return false;
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            };
            const interactiveSelector = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], [tabindex]:not([tabindex="-1"]), [aria-label], [data-testid], [data-test-id], [jsaction], [onclick]';
            const escapeRegExp = (input) => {
              const special = '\\\\^$.*+?()[]{}|';
              let out = '';
              for (const ch of String(input || '')) out += special.includes(ch) ? ('\\\\\\\\' + ch) : ch;
              return out;
            };
            const findByText = (needle) => {
              const all = Array.from(document.querySelectorAll(interactiveSelector + ', div, span, li'));
              const pattern = new RegExp(escapeRegExp(String(needle || '').toLowerCase().trim()));
              for (const el of all) {
                if (!isVisible(el)) continue;
                const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).replace(/\\s+/g, ' ').trim();
                if (!text) continue;
                if (pattern.test(text.toLowerCase())) return el.closest(interactiveSelector) || el;
              }
              return null;
            };
            let el = null;
            try { el = document.querySelector(sel); } catch {}
            if (!el && sel.startsWith('text=')) {
              const raw = sel.slice(5).replace(/^['"]|['"]$/g, '').trim();
              if (raw) el = findByText(raw);
            }
            if (!el) {
              const hasTextMatch = sel.match(/:has-text\\((['"])(.*?)\\1\\)/i);
              if (hasTextMatch?.[2]) el = findByText(hasTextMatch[2]);
            }
            if (!el) {
              const containsMatch = sel.match(/:contains\\((['"])(.*?)\\1\\)/i);
              if (containsMatch?.[2]) el = findByText(containsMatch[2]);
            }
            if (!el) return '${right ? 'Right click' : 'Click'} failed on "' + sel + '": element not found';
            if (el instanceof HTMLElement) {
              el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
            }
            const rect = el.getBoundingClientRect();
            const x = Math.round(rect.left + rect.width / 2);
            const y = Math.round(rect.top + rect.height / 2);
            
            const opts = {
              bubbles: true,
              cancelable: true,
              view: window,
              button: ${right ? 2 : 0},
              buttons: ${right ? 2 : 1},
              clientX: x,
              clientY: y,
            };
            
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('${eventName}', opts));
            
            if (!${right} && typeof el.click === 'function') {
              el.click();
            }
            return '${right ? 'Right-clicked' : 'Clicked'}: ' + sel;
          } catch (e) {
            return '${right ? 'Right click' : 'Click'} error: ' + (e?.message || String(e));
          }
        })();`,
        true,
      );
      return String(result || '');
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (
        msg.includes('Script failed to execute') ||
        msg.includes('context was destroyed') ||
        msg.includes('destroyed') ||
        (tab.view?.webContents && tab.view.webContents.isDestroyed())
      ) {
        return `${right ? 'Right-clicked' : 'Clicked'} (navigation triggered): ${selector}`;
      }
      throw err;
    }
  }

  private async setCheckedState(selector: string, targetState: boolean): Promise<string> {
    const active = await this.requireActiveTab();
    return await active.view.webContents.executeJavaScript(
      `(function(){
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return '${targetState ? 'check' : 'uncheck'} failed: element not found';
        const isChecked = !!(el.checked || el.getAttribute('aria-checked') === 'true');
        if (isChecked !== ${targetState ? 'true' : 'false'}) {
          el.click();
        }
        return '${targetState ? 'check' : 'uncheck'}ed ${selector}';
      })();`,
      true,
    );
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  dispose(): void {
    for (const tab of this.tabs.values()) {
      try {
        tab.view.webContents.close({ waitForBeforeUnload: false });
      } catch {}
    }
    this.tabs.clear();
    this.consoleLogsByTab.clear();

    if (this.playwrightBrowser) {
      this.playwrightBrowser.close().catch(() => {});
      this.playwrightBrowser = null;
      this.playwrightContext = null;
    }
  }
}
