import { BrowserWindow } from 'electron';
import type { BrowserState, TabInfo } from '../shared/types';

export interface AgentAutomationController {
  getActiveTabId(): string | null;
  getAgentTabId(): string | null;
  setAgentTabId(id: string | null): void;
  getBrowserState(): Promise<BrowserState>;
  navigate(url: string): Promise<void>;
  search(query: string): Promise<string>;
  highlightElement(selector: string): Promise<void>;
  click(selector: string): Promise<string>;
  selectOption(selector: string, value: string): Promise<string>;
  typeText(selector: string, text: string): Promise<string>;
  pressEnter(): Promise<string>;
  scroll(direction: string): Promise<string>;
  newTab(url?: string): Promise<string>;
  switchTab(tabId: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
}

export class RendererAutomationController implements AgentAutomationController {
  private activeTabId: string | null = null;
  private agentTabId: string | null = null;

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  getActiveTabId(): string | null {
    return this.agentTabId || this.activeTabId;
  }

  getAgentTabId(): string | null {
    return this.agentTabId;
  }

  setAgentTabId(id: string | null): void {
    this.agentTabId = id || null;
    void this.invoke<boolean>('setAgentTabId', { tabId: this.agentTabId }).catch(() => {});
  }

  async getBrowserState(): Promise<BrowserState> {
    const state = await this.invoke<BrowserState>('getBrowserState', { tabId: this.agentTabId });
    const active = state.tabs.find((t) => t.active);
    this.activeTabId = active?.id || this.activeTabId;
    return state;
  }

  async navigate(url: string): Promise<void> {
    await this.invoke<boolean>('navigate', { tabId: this.agentTabId, url });
  }

  async search(query: string): Promise<string> {
    await this.invoke<boolean>('search', { tabId: this.agentTabId, query });
    return `Searched Google for: ${query}`;
  }

  async highlightElement(selector: string): Promise<void> {
    await this.invoke<boolean>('highlightElement', { tabId: this.agentTabId, selector });
  }

  async click(selector: string): Promise<string> {
    return await this.invoke<string>('click', { tabId: this.agentTabId, selector });
  }

  async selectOption(selector: string, value: string): Promise<string> {
    return await this.invoke<string>('selectOption', { tabId: this.agentTabId, selector, value });
  }

  async typeText(selector: string, text: string): Promise<string> {
    return await this.invoke<string>('typeText', { tabId: this.agentTabId, selector, value: text });
  }

  async pressEnter(): Promise<string> {
    return await this.invoke<string>('pressEnter', { tabId: this.agentTabId });
  }

  async scroll(direction: string): Promise<string> {
    return await this.invoke<string>('scroll', { tabId: this.agentTabId, direction });
  }

  async newTab(url?: string): Promise<string> {
    const tabId = await this.invoke<string>('newTab', { url });
    if (tabId) {
      this.activeTabId = tabId;
      this.agentTabId = tabId;
    }
    return tabId;
  }

  async switchTab(tabId: string): Promise<void> {
    await this.invoke<boolean>('switchTab', { tabId });
    this.activeTabId = tabId;
    if (this.agentTabId) this.agentTabId = tabId;
  }

  async closeTab(tabId: string): Promise<void> {
    await this.invoke<boolean>('closeTab', { tabId });
    if (this.activeTabId === tabId) this.activeTabId = null;
    if (this.agentTabId === tabId) this.agentTabId = null;
  }

  private async invoke<T>(method: string, payload?: Record<string, unknown>): Promise<T> {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) {
      throw new Error('Renderer window unavailable');
    }
    const request = JSON.stringify({ method, payload: payload || {} });
    const script = `(async () => {
      const bridge = window.__bronBridgeExecute;
      if (typeof bridge !== 'function') throw new Error('Renderer bridge unavailable');
      return await bridge(${request});
    })();`;
    
    let lastError: any;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        return await win.webContents.executeJavaScript(script, true) as T;
      } catch (err: any) {
        lastError = err;
        const errMsg = String(err.message || '');
        
        // If the error is related to guest views or script failure, it might be a transient state
        if (errMsg.includes('GUEST_VIEW_MANAGER_CALL') || errMsg.includes('Script failed to execute')) {
          // Wait slightly longer on these specific errors
          await new Promise((resolve) => setTimeout(resolve, 250 + (attempt * 100)));
          continue;
        }
        
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    
    const finalMsg = lastError?.message || String(lastError);
    throw new Error(`Bridge invoke failed after retries: ${finalMsg}`);
  }

  async getTabs(): Promise<TabInfo[]> {
    return await this.invoke<TabInfo[]>('getTabs');
  }
}
