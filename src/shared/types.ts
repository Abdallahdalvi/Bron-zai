// ── Tab & Browser State ──────────────────────────────────────────────

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  active: boolean;
  initialUrl?: string;
  groupId?: string;
  pinned?: boolean;
}

export interface TabGroupInfo {
  id: string;
  title: string;
  color?: string;
  tabIds: string[];
}

export interface ClickableElement {
  text: string;
  tag: string;
  role?: string;
  selector: string;
  badge: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InputField {
  placeholder?: string;
  label?: string;
  type: string;
  selector: string;
  badge: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserState {
  url: string;
  title: string;
  visibleText: string;
  clickableElements: ClickableElement[];
  inputFields: InputField[];
  tabs: TabInfo[];
  tabGroups?: TabGroupInfo[];
  screenshot?: string; // base64 jpeg
  prunedDomTree?: string;
}

export interface RuntimeContext {
  windowPartition: string;
  incognito: boolean;
  browserBackend?: 'webcontentsview';
}

export interface BrowserViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
  activeTabId?: string | null;
  sidebarOpen?: boolean;
}

export interface BookmarkEntry {
  id: number;
  title: string;
  url: string;
  folder: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface HistoryEntry {
  id: number;
  url: string;
  title: string;
  visited_at: string;
}

// ── Agent ────────────────────────────────────────────────────────────

export interface AgentAction {
  thought: string;
  action:
    | 'take_snapshot'
    | 'take_enhanced_snapshot'
    | 'get_page_content'
    | 'get_page_links'
    | 'get_dom'
    | 'search_dom'
    | 'take_screenshot'
    | 'evaluate_script'
    | 'get_console_logs'
    | 'navigate_page'
    | 'new_page'
    | 'close_page'
    | 'list_pages'
    | 'get_active_page'
    | 'open_url'
    | 'search'
    | 'click'
    | 'click_at'
    | 'right_click'
    | 'right_click_at'
    | 'fill'
    | 'clear'
    | 'check'
    | 'uncheck'
    | 'select_option'
    | 'upload_file'
    | 'type'
    | 'press_key'
    | 'press_enter'
    | 'focus'
    | 'hover'
    | 'hover_at'
    | 'scroll'
    | 'drag'
    | 'drag_at'
    | 'extract'
    | 'summarize'
    | 'new_tab'
    | 'switch_tab'
    | 'close_tab'
    | 'filesystem_read'
    | 'filesystem_write'
    | 'filesystem_edit'
    | 'filesystem_bash'
    | 'filesystem_grep'
    | 'filesystem_find'
    | 'filesystem_ls'
    | 'get_bookmarks'
    | 'create_bookmark'
    | 'remove_bookmark'
    | 'update_bookmark'
    | 'move_bookmark'
    | 'search_bookmarks'
    | 'search_history'
    | 'get_recent_history'
    | 'delete_history_url'
    | 'delete_history_range'
    | 'list_tab_groups'
    | 'group_tabs'
    | 'update_tab_group'
    | 'ungroup_tabs'
    | 'close_tab_group'
    | 'save_pdf'
    | 'save_screenshot'
    | 'download_file'
    | 'list_workflows'
    | 'save_workflow'
    | 'delete_workflow'
    | 'list_saved_credentials'
    | 'save_saved_credential'
    | 'delete_saved_credential'
    | 'list_autofill_profiles'
    | 'save_autofill_profile'
    | 'delete_autofill_profile'
    | 'discover_server_categories_or_actions'
    | 'execute_action'
    | 'search_documentation'
    | 'suggest_schedule'
    | 'memory_search'
    | 'memory_write'
    | 'memory_read_core'
    | 'memory_update_core'
    | 'soul_read'
    | 'soul_update'
    | 'remember'
    | 'run_skill'
    | 'act'
    | 'extract'
    | 'validate'
    | 'done';
  target: string;
  value: string;
  reason: string;
}

export const VALID_ACTIONS = [
  'take_snapshot',
  'take_enhanced_snapshot',
  'get_page_content',
  'get_page_links',
  'get_dom',
  'search_dom',
  'take_screenshot',
  'evaluate_script',
  'get_console_logs',
  'navigate_page',
  'new_page',
  'close_page',
  'list_pages',
  'get_active_page',
  'open_url',
  'search',
  'click',
  'click_at',
  'right_click',
  'right_click_at',
  'fill',
  'clear',
  'check',
  'uncheck',
  'select_option',
  'upload_file',
  'type',
  'press_key',
  'press_enter',
  'focus',
  'hover',
  'hover_at',
  'scroll',
  'drag',
  'drag_at',
  'extract',
  'summarize',
  'new_tab',
  'switch_tab',
  'close_tab',
  'filesystem_read',
  'filesystem_write',
  'filesystem_edit',
  'filesystem_bash',
  'filesystem_grep',
  'filesystem_find',
  'filesystem_ls',
  'get_bookmarks',
  'create_bookmark',
  'remove_bookmark',
  'update_bookmark',
  'move_bookmark',
  'search_bookmarks',
  'search_history',
  'get_recent_history',
  'delete_history_url',
  'delete_history_range',
  'list_tab_groups',
  'group_tabs',
  'update_tab_group',
  'ungroup_tabs',
  'close_tab_group',
  'save_pdf',
  'save_screenshot',
  'download_file',
  'list_workflows',
  'save_workflow',
  'delete_workflow',
  'list_saved_credentials',
  'save_saved_credential',
  'delete_saved_credential',
  'list_autofill_profiles',
  'save_autofill_profile',
  'delete_autofill_profile',
  'discover_server_categories_or_actions',
  'execute_action',
  'search_documentation',
  'suggest_schedule',
  'memory_search',
  'memory_write',
  'memory_read_core',
  'memory_update_core',
  'soul_read',
  'soul_update',
  'remember',
  'run_skill',
  'act',
  'extract',
  'validate',
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

export interface MemorySearchHit {
  file: string;
  kind: 'core' | 'soul' | 'daily';
  snippet: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  triggers: string[];
  tools: string[];
  scriptDir: string;
  sourcePath: string;
}

export interface ChatSession {
  id: number;
  title: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface WorkflowRecord {
  id: number;
  title: string;
  task_prompt: string;
  notes: string;
  created_at: string;
  updated_at: string;
  last_run_at?: string;
}

export interface WorkflowScheduleRecord {
  id: number;
  workflow_id: number;
  rrule: string;
  enabled: boolean;
  next_run_at?: string;
  last_run_at?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunRecord {
  id: number;
  workflow_id: number;
  origin: 'manual' | 'scheduled' | 'retry';
  status: 'running' | 'completed' | 'failed' | 'stopped';
  task_snapshot: string;
  result_summary: string;
  step_count: number;
  error_message?: string;
  started_at: string;
  ended_at?: string;
}

export interface BrowserExtensionRecord {
  id: number;
  name: string;
  source_path: string;
  extension_id: string;
  version: string;
  enabled: boolean;
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface SavedCredentialRecord {
  id: number;
  domain: string;
  username: string;
  notes: string;
  has_password: boolean;
  created_at: string;
  updated_at: string;
  last_used_at?: string;
}

export interface AutofillProfileRecord {
  id: number;
  label: string;
  full_name: string;
  email: string;
  phone: string;
  company: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  created_at: string;
  updated_at: string;
}

export interface BrowserAutofillContext {
  credential?: {
    domain: string;
    username: string;
    password: string;
  };
  profile?: AutofillProfileRecord;
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
  workflowId?: number;
  workflowRunId?: number;
  workflowOrigin?: 'manual' | 'scheduled' | 'retry';
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
  agentFullAccess: boolean;
  agentToolHints: boolean;
  agentPromptEnhancement: boolean;
  autoSaveSignIns: boolean;
  workflowSchedulerEnabled: boolean;
  syncAccountName: string;
  syncPassphrase: string;
  syncBundlePath: string;
  maxSteps: number;
  maxRuntimeMinutes: number;
  browserProfile: string;
  domainProfiles: string;
  theme: 'light' | 'dark';
  
  // Cost Guard settings
  costGuardMaxCostPerTask: number;
  costGuardMaxCostPerDay: number;
  costGuardMaxRequestsPerMinute: number;
  costGuardMaxConsecutiveErrors: number;
  costGuardCooldownMs: number;
  
  // Semantic memory settings
  embeddingProvider: 'local' | 'openai' | 'openrouter';
  openaiApiKey: string;
  strataConnections: string;
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
  model: 'google/gemini-2.5-pro-exp-03-25:free',  // Free tier default
  headless: true,
  saveMemory: true,
  agentFullAccess: true,
  agentToolHints: true,
  agentPromptEnhancement: true,
  autoSaveSignIns: true,
  workflowSchedulerEnabled: true,
  syncAccountName: 'Local Browser',
  syncPassphrase: '',
  syncBundlePath: '',
  maxSteps: 0,           // 0 = unlimited steps
  maxRuntimeMinutes: 0,  // 0 = unlimited runtime
  browserProfile: 'default',
  domainProfiles: '{}',
  theme: 'dark',
  
  // Cost Guard defaults
  costGuardMaxCostPerTask: 1.0,        // $1.00 USD per task
  costGuardMaxCostPerDay: 10.0,        // $10.00 USD per day
  costGuardMaxRequestsPerMinute: 30,   // 30 req/min rate limit
  costGuardMaxConsecutiveErrors: 5,    // Circuit breaker threshold
  costGuardCooldownMs: 60000,          // 1 minute cooldown
  
  // Semantic memory defaults
  embeddingProvider: 'local',          // Use local embeddings (privacy-first)
  openaiApiKey: '',                    // Optional OpenAI key for better embeddings
  strataConnections: '{}',             // JSON object of MCP connections
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
  MEMORY_SEARCH: 'memory:search',
  MEMORY_WRITE_DAILY: 'memory:writeDaily',
  MEMORY_READ_CORE: 'memory:readCore',
  MEMORY_UPDATE_CORE: 'memory:updateCore',
  SOUL_READ: 'memory:soulRead',
  SOUL_UPDATE: 'memory:soulUpdate',
  GET_CREDIT_USAGE_HISTORY: 'memory:getCreditUsageHistory',
  GET_HISTORY: 'memory:getHistory',
  ADD_HISTORY_ENTRY: 'memory:addHistory',
  DELETE_HISTORY_ENTRY: 'memory:deleteHistoryEntry',
  DELETE_HISTORY_URL: 'memory:deleteHistoryUrl',
  DELETE_HISTORY_RANGE: 'memory:deleteHistoryRange',
  CLEAR_HISTORY: 'memory:clearHistory',
  GET_BOOKMARKS: 'memory:getBookmarks',
  CREATE_BOOKMARK: 'memory:createBookmark',
  UPDATE_BOOKMARK: 'memory:updateBookmark',
  REMOVE_BOOKMARK: 'memory:removeBookmark',
  SEARCH_BOOKMARKS: 'memory:searchBookmarks',

  // Skills
  GET_SKILLS: 'skills:getAll',
  FIND_SKILL: 'skills:find',

  // Chat History
  GET_CHAT_SESSIONS: 'chat:getSessions',
  GET_CHAT_SESSION: 'chat:getSession',
  SAVE_CHAT_SESSION: 'chat:saveSession',
  DELETE_CHAT_SESSION: 'chat:deleteSession',
  GET_WORKFLOWS: 'workflow:getAll',
  SAVE_WORKFLOW: 'workflow:save',
  DELETE_WORKFLOW: 'workflow:delete',
  RUN_WORKFLOW_NOW: 'workflow:runNow',
  GET_WORKFLOW_RUNS: 'workflow:getRuns',
  GET_WORKFLOW_SCHEDULES: 'workflow:getSchedules',
  SAVE_WORKFLOW_SCHEDULE: 'workflow:saveSchedule',
  DELETE_WORKFLOW_SCHEDULE: 'workflow:deleteSchedule',
  PICK_EXTENSION_DIRECTORY: 'browser:pickExtensionDirectory',
  GET_BROWSER_EXTENSIONS: 'browser:getExtensions',
  SAVE_BROWSER_EXTENSION: 'browser:saveExtension',
  DELETE_BROWSER_EXTENSION: 'browser:deleteExtension',
  GET_SAVED_CREDENTIALS: 'browser:getSavedCredentials',
  SAVE_SAVED_CREDENTIAL: 'browser:saveSavedCredential',
  DELETE_SAVED_CREDENTIAL: 'browser:deleteSavedCredential',
  GET_AUTOFILL_PROFILES: 'browser:getAutofillProfiles',
  SAVE_AUTOFILL_PROFILE: 'browser:saveAutofillProfile',
  DELETE_AUTOFILL_PROFILE: 'browser:deleteAutofillProfile',
  GET_AUTOFILL_CONTEXT: 'browser:getAutofillContext',
  EXPORT_SYNC_BUNDLE: 'sync:exportBundle',
  IMPORT_SYNC_BUNDLE: 'sync:importBundle',

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
  SWITCH_BROWSER_PROFILE: 'browser:switchProfile',
  SHOW_HISTORY_PANEL: 'browser:showHistoryPanel',
  GET_RUNTIME_CONTEXT: 'app:getRuntimeContext',
  SET_BROWSER_VIEWPORT: 'browser:setViewport',
  ADJUST_BROWSER_ZOOM: 'browser:adjustZoom',
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
  searchMemory: (query: string | string[]) => Promise<MemorySearchHit[]>;
  writeDailyMemory: (content: string, title?: string) => Promise<{ path: string }>;
  readCoreMemory: () => Promise<string>;
  updateCoreMemory: (additions: string[], removals: string[]) => Promise<{ updated: boolean }>;
  readSoul: () => Promise<string>;
  updateSoul: (content: string) => Promise<{ updated: boolean }>;
  getCreditUsageHistory: (limit?: number) => Promise<CreditUsageRecord[]>;
  getHistory: (limit?: number) => Promise<HistoryEntry[]>;
  addHistoryEntry: (url: string, title: string) => Promise<void>;
  deleteHistoryEntry: (id: number) => Promise<{ deleted: boolean }>;
  deleteHistoryUrl: (url: string) => Promise<{ deleted: boolean }>;
  deleteHistoryRange: (start?: string, end?: string) => Promise<{ deleted: boolean }>;
  clearHistory: () => Promise<{ cleared: boolean }>;
  getBookmarks: () => Promise<BookmarkEntry[]>;
  createBookmark: (bookmark: Partial<BookmarkEntry> & { url: string }) => Promise<BookmarkEntry>;
  updateBookmark: (id: number, updates: Partial<BookmarkEntry>) => Promise<BookmarkEntry | null>;
  removeBookmark: (id: number) => Promise<{ deleted: boolean }>;
  searchBookmarks: (query: string) => Promise<BookmarkEntry[]>;
  getSkills: () => Promise<SkillDefinition[]>;
  findSkill: (query: string) => Promise<SkillDefinition | null>;

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
  getWorkflows: () => Promise<WorkflowRecord[]>;
  saveWorkflow: (workflow: Partial<WorkflowRecord>) => Promise<number>;
  deleteWorkflow: (id: number) => Promise<{ deleted: boolean }>;
  runWorkflowNow: (id: number) => Promise<{ started: boolean; reason?: string }>;
  getWorkflowRuns: (workflowId?: number) => Promise<WorkflowRunRecord[]>;
  getWorkflowSchedules: (workflowId?: number) => Promise<WorkflowScheduleRecord[]>;
  saveWorkflowSchedule: (schedule: Partial<WorkflowScheduleRecord>) => Promise<number>;
  deleteWorkflowSchedule: (id: number) => Promise<{ deleted: boolean }>;
  pickExtensionDirectory: () => Promise<string | null>;
  getBrowserExtensions: () => Promise<BrowserExtensionRecord[]>;
  saveBrowserExtension: (extension: Partial<BrowserExtensionRecord> & { source_path: string }) => Promise<BrowserExtensionRecord>;
  deleteBrowserExtension: (id: number) => Promise<{ deleted: boolean }>;
  getSavedCredentials: () => Promise<SavedCredentialRecord[]>;
  saveSavedCredential: (credential: Partial<SavedCredentialRecord> & { domain: string; username?: string; password?: string; notes?: string }) => Promise<SavedCredentialRecord>;
  deleteSavedCredential: (id: number) => Promise<{ deleted: boolean }>;
  getAutofillProfiles: () => Promise<AutofillProfileRecord[]>;
  saveAutofillProfile: (profile: Partial<AutofillProfileRecord> & { label: string }) => Promise<AutofillProfileRecord>;
  deleteAutofillProfile: (id: number) => Promise<{ deleted: boolean }>;
  getAutofillContext: (url: string) => Promise<BrowserAutofillContext>;
  exportSyncBundle: () => Promise<{ saved: boolean; path?: string; reason?: string }>;
  importSyncBundle: () => Promise<{ imported: boolean; reason?: string }>;
  
  // Misc
  openReportWindow: (html: string) => Promise<void>;
  exitApp: () => Promise<void>;
  clearData: () => Promise<void>;
  openDownloads: () => Promise<void>;
  openHistory: () => Promise<void>;
  newWindow: () => Promise<void>;
  newIncognitoWindow: () => Promise<void>;
  switchBrowserProfile: (profileName: string) => Promise<{ switched: boolean }>;
  getRuntimeContext: () => Promise<RuntimeContext>;
  setBrowserViewport: (viewport: BrowserViewportRect) => Promise<{ applied: boolean }>;
  adjustBrowserZoom: (delta: number) => Promise<number>;

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
  onShowHistoryPanel: (cb: (_e: any) => void) => () => void;

  // Generic invoke
  invoke: (channel: string, ...args: any[]) => Promise<any>;
}


// ── Webview Type Extension ──────────────────────────────────────────

declare global {
  interface Window {
    bronAPI: BronAPI;
  }
}
