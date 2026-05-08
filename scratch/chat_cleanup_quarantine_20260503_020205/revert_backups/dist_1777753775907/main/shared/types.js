"use strict";
// ── Tab & Browser State ──────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPC = exports.DEFAULT_SETTINGS = exports.VALID_ACTIONS = void 0;
exports.VALID_ACTIONS = [
    'open_url',
    'search',
    'click',
    'select_option',
    'type',
    'press_enter',
    'scroll',
    'extract',
    'summarize',
    'new_tab',
    'switch_tab',
    'close_tab',
    'remember',
    'done',
];
exports.DEFAULT_SETTINGS = {
    apiKey: '',
    model: 'google/gemma-3-27b-it',
    headless: true,
    saveMemory: true,
    maxSteps: 500,
    maxRuntimeMinutes: 0,
    browserProfile: 'default',
    domainProfiles: '{}',
};
// ── IPC Channel Names ────────────────────────────────────────────────
exports.IPC = {
    // Browser
    NAVIGATE: 'browser:navigate',
    GO_BACK: 'browser:goBack',
    GO_FORWARD: 'browser:goForward',
    REFRESH: 'browser:refresh',
    NEW_TAB: 'browser:newTab',
    CLOSE_TAB: 'browser:closeTab',
    SWITCH_TAB: 'browser:switchTab',
    GET_STATE: 'browser:getState',
    GET_SCREENSHOT: 'browser:getScreenshot',
    GET_TABS: 'browser:getTabs',
    OPEN_EXTERNAL_URL: 'browser:openExternalUrl',
    // Agent
    RUN_AGENT: 'agent:run',
    STOP_AGENT: 'agent:stop',
    PICK_ATTACHMENTS: 'agent:pickAttachments',
    AGENT_STEP: 'agent:step', // main → renderer
    AGENT_DONE: 'agent:done', // main → renderer
    AGENT_ERROR: 'agent:error', // main → renderer
    // Memory
    GET_MEMORIES: 'memory:getAll',
    CLEAR_MEMORIES: 'memory:clearAll',
    SAVE_MEMORY: 'memory:save',
    // Chat History
    GET_CHAT_SESSIONS: 'chat:getSessions',
    GET_CHAT_SESSION: 'chat:getSession',
    SAVE_CHAT_SESSION: 'chat:saveSession',
    DELETE_CHAT_SESSION: 'chat:deleteSession',
    // Settings
    GET_SETTINGS: 'settings:get',
    SAVE_SETTINGS: 'settings:save',
    GET_MODELS: 'settings:getModels',
    // Browser Highlight
    HIGHLIGHT_ELEMENT: 'browser:highlight',
    // Status
    BROWSER_READY: 'status:browserReady',
    BROWSER_ERROR: 'status:browserError',
    TAB_UPDATED: 'status:tabUpdated',
};
//# sourceMappingURL=types.js.map