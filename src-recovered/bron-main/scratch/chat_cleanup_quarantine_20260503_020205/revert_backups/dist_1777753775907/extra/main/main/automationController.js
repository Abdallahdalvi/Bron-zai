"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RendererAutomationController = void 0;
class RendererAutomationController {
    getWindow;
    activeTabId = null;
    agentTabId = null;
    constructor(getWindow) {
        this.getWindow = getWindow;
    }
    getActiveTabId() {
        return this.agentTabId || this.activeTabId;
    }
    setAgentTabId(id) {
        this.agentTabId = id || null;
        void this.invoke('setAgentTabId', { tabId: this.agentTabId }).catch(() => { });
    }
    async getBrowserState() {
        const state = await this.invoke('getBrowserState', { tabId: this.agentTabId });
        const active = state.tabs.find((t) => t.active);
        this.activeTabId = active?.id || this.activeTabId;
        return state;
    }
    async navigate(url) {
        await this.invoke('navigate', { tabId: this.agentTabId, url });
    }
    async search(query) {
        await this.invoke('search', { tabId: this.agentTabId, query });
        return `Searched Google for: ${query}`;
    }
    async highlightElement(selector) {
        await this.invoke('highlightElement', { tabId: this.agentTabId, selector });
    }
    async click(selector) {
        return await this.invoke('click', { tabId: this.agentTabId, selector });
    }
    async selectOption(selector, value) {
        return await this.invoke('selectOption', { tabId: this.agentTabId, selector, value });
    }
    async typeText(selector, text) {
        return await this.invoke('typeText', { tabId: this.agentTabId, selector, value: text });
    }
    async pressEnter() {
        return await this.invoke('pressEnter', { tabId: this.agentTabId });
    }
    async scroll(direction) {
        return await this.invoke('scroll', { tabId: this.agentTabId, direction });
    }
    async newTab(url) {
        const tabId = await this.invoke('newTab', { url });
        if (tabId) {
            this.activeTabId = tabId;
            this.agentTabId = tabId;
        }
        return tabId;
    }
    async switchTab(tabId) {
        await this.invoke('switchTab', { tabId });
        this.activeTabId = tabId;
        if (this.agentTabId)
            this.agentTabId = tabId;
    }
    async closeTab(tabId) {
        await this.invoke('closeTab', { tabId });
        if (this.activeTabId === tabId)
            this.activeTabId = null;
        if (this.agentTabId === tabId)
            this.agentTabId = null;
    }
    async invoke(method, payload) {
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
        let lastError;
        for (let attempt = 0; attempt < 8; attempt++) {
            try {
                return await win.webContents.executeJavaScript(script, true);
            }
            catch (err) {
                lastError = err;
                await new Promise((resolve) => setTimeout(resolve, 120));
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Bridge invoke failed'));
    }
    async getTabs() {
        return await this.invoke('getTabs');
    }
}
exports.RendererAutomationController = RendererAutomationController;
//# sourceMappingURL=automationController.js.map