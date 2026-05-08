// ── Tab & Browser State ──────────────────────────────────────────────

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  active: boolean;
  initialUrl?: string;
}

export interface ClickableElement {
  text: string;
  tag: string;
  role?: string;
  selector: string;
}

export interface InputField {
  placeholder?: string;
  label?: string;
  type: string;
  selector: string;
}

export interface BrowserState {
  url: string;
  title: string;
  visibleText: string;
  clickableElements: ClickableElement[];
  inputFields: InputField[];
  tabs: TabInfo[];
  screenshot?: string; // base64 jpeg
}

// ── Agent ────────────────────────────────────────────────────────────

export interface AgentAction {
  thought: string;
  action:
    | 'open_url'
    | 'search'
    | 'click'
    | 'select_option'
    | 'type'
    | 'press_enter'
    | 'scroll'
    | 'extract'
    | 'summarize'
    | 'new_tab'
    | 'switch_tab'
    | 'close_tab'
    | 'remember'
    | 'done';
  target: string;
  value: string;
  reason: string;
}

export const VALID_ACTIONS = [
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
] as const;

// ── Chat ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system' | 'step' | 'done' | 'error';
  content: string;
  timestamp: number;
  action?: AgentAction;
  type?: 'thinking' | 'action' | 'result' | 'error' | 'confirmation';
}

// ── Memory / DB ──────────────────────────────────────────────────────

export interface Memory {
  id: number;
  key: string;
  value: string;
  source: string;
  session_id?: number;
  task_id?: number;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: number;
  title: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface AgentAttachment {
  id: string;
  name: string;
  path: string;
  kind: 'text' | 'image' | 'unsupported';
  mimeType: string;
  sizeBytes: number;
  textContent?: string;
  imageDataUrl?: string;
  note?: string;
}

export interface AgentRunRequest {
  task: string;
  attachments?: AgentAttachment[];
  contextMessages?: string[];
  sessionId?: number;
  isChatMode?: boolean;
}

export interface TaskRecord {
  id: number;
  task: string;
  status: 'running' | 'completed' | 'stopped' | 'failed';
  started_at: string;
  ended_at?: string;
}

export interface StepRecord {
  id: number;
  task_id: number;
  step_number: number;
  action: string;
  target: string;
  value: string;
  result: string;
  created_at: string;
}

export interface CreditUsageRecord {
  id: number;
  task_id?: number;
  session_id?: number;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: number;
  created_at: string;
}

// ── Settings ─────────────────────────────────────────────────────────

export interface Settings {
  apiKey: string;
  model: string;
  headless: boolean;
  saveMemory: boolean;
  maxSteps: number;
  maxRuntimeMinutes: number;
  browserProfile: string;
  domainProfiles: string;
  theme: 'light' | 'dark';
}

export interface ModelInfo {
  id: string;
  name: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  description?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'deepseek/deepseek-chat',
  headless: true,
  saveMemory: true,
  maxSteps: 0,
  maxRuntimeMinutes: 0,
  browserProfile: 'default',
  domainProfiles: '{}',
  theme: 'dark',
};

// ── IPC Channel Names ────────────────────────────────────────────────

export const IPC = {
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
  AGENT_STEP: 'agent:step',        // main → renderer
  AGENT_DONE: 'agent:done',        // main → renderer
  AGENT_ERROR: 'agent:error',      // main → renderer
  AGENT_SCREENSHOT: 'agent:screenshot', // main → renderer

  // Memory
  GET_MEMORIES: 'memory:getAll',
  CLEAR_MEMORIES: 'memory:clearAll',
  SAVE_MEMORY: 'memory:save',
  GET_CREDIT_USAGE_HISTORY: 'memory:getCreditUsageHistory',
  GET_HISTORY: 'memory:getHistory',
  ADD_HISTORY_ENTRY: 'memory:addHistory',

  // Chat History
  GET_CHAT_SESSIONS: 'chat:getSessions',
  GET_CHAT_SESSION: 'chat:getSession',
  SAVE_CHAT_SESSION: 'chat:saveSession',
  DELETE_CHAT_SESSION: 'chat:deleteSession',

  // Settings
  GET_SETTINGS: 'settings:get',
  SAVE_SETTINGS: 'settings:save',
  GET_MODELS: 'settings:getModels',
  GET_PROFILES: 'settings:getProfiles',

  // Browser Highlight
  HIGHLIGHT_ELEMENT: 'browser:highlight',

  // Status
  BROWSER_READY: 'status:browserReady',
  BROWSER_ERROR: 'status:browserError',
  TAB_UPDATED: 'status:tabUpdated',
  OPEN_REPORT_WINDOW: 'misc:openReportWindow',
  EXIT_APP: 'app:exit',
  CLEAR_DATA: 'browser:clearData',
  OPEN_DOWNLOADS: 'browser:openDownloads',
  OPEN_HISTORY: 'browser:openHistory',
  NEW_WINDOW: 'browser:newWindow',
  NEW_INCOGNITO_WINDOW: 'browser:newIncognitoWindow',
} as const;

// ── Global API Declaration ──────────────────────────────────────────

export interface BronAPI {
  // Browser
  navigate: (url: string) => Promise<any>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  refresh: () => Promise<void>;
  newTab: (url?: string) => Promise<string>;
  closeTab: (tabId: string) => Promise<any>;
  switchTab: (tabId: string) => Promise<any>;
  getState: () => Promise<BrowserState>;
  getScreenshot: () => Promise<string>;
  getTabs: () => Promise<TabInfo[]>;
  openExternalUrl: (url: string) => Promise<{ opened: boolean; reason?: string }>;

  // Agent
  runAgent: (taskInput: string | AgentRunRequest) => Promise<{ started: boolean }>;
  stopAgent: () => Promise<{ stopped: boolean }>;
  pickAgentAttachments: () => Promise<AgentAttachment[]>;

  // Memory
  getMemories: () => Promise<Memory[]>;
  clearMemories: () => Promise<{ cleared: boolean }>;
  saveMemory: (key: string, value: string, source: string) => Promise<{ saved: boolean }>;
  getCreditUsageHistory: (limit?: number) => Promise<CreditUsageRecord[]>;
  getHistory: () => Promise<any[]>;
  addHistoryEntry: (url: string, title: string) => Promise<void>;

  // Settings
  getSettings: () => Promise<Settings>;
  getModels: () => Promise<ModelInfo[]>;
  getProfiles: () => Promise<string[]>;
  saveSettings: (settings: Record<string, unknown>) => Promise<{ saved: boolean }>;

  // Chat History
  getChatSessions: () => Promise<ChatSession[]>;
  getChatSession: (id: number) => Promise<ChatSession | null>;
  saveChatSession: (title: string, messages: any[], id?: number) => Promise<number>;
  deleteChatSession: (id: number) => Promise<{ deleted: boolean }>;
  
  // Misc
  openReportWindow: (html: string) => Promise<void>;
  exitApp: () => Promise<void>;
  clearData: () => Promise<void>;
  openDownloads: () => Promise<void>;
  openHistory: () => Promise<void>;
  newWindow: () => Promise<void>;
  newIncognitoWindow: () => Promise<void>;

  // Browser Highlight
  highlightElement: (selector: string) => Promise<{ highlighted: boolean }>;

  // Event listeners (main → renderer)
  onAgentStep: (cb: (_e: any, data: any) => void) => () => void;
  onAgentDone: (cb: (_e: any, data: any) => void) => () => void;
  onAgentError: (cb: (_e: any, data: any) => void) => () => void;
  onAgentScreenshot: (cb: (_e: any, data: string) => void) => () => void;
  onBrowserReady: (cb: (_e: any) => void) => () => void;
  onBrowserError: (cb: (_e: any, data: any) => void) => () => void;
  onTabUpdated: (cb: (_e: any, data: any) => void) => () => void;
  onNewTabRequest: (cb: (_e: any, url: string) => void) => () => void;

  // Generic invoke
  invoke: (channel: string, ...args: any[]) => Promise<any>;
}


// ── Webview Type Extension ──────────────────────────────────────────

export interface ElectronWebview extends HTMLElement {
  getURL(): string;
  loadURL(url: string, options?: any): Promise<void>;
  getTitle(): string;
  isLoading(): boolean;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  executeJavaScript(code: string, userGesture?: boolean): Promise<any>;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  getZoomFactor(): number;
  setZoomFactor(factor: number): void;
  send(channel: string, ...args: any[]): void;
  addEventListener(type: string, listener: (e: any) => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (e: any) => void, options?: boolean | EventListenerOptions): void;
}

declare global {
  interface Window {
    bronAPI: BronAPI;
  }
}
