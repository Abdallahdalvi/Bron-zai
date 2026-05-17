/**
 * StrataMCP — Real MCP/Strata integration for external app connectivity
 * This replaces the mock implementation in strata.ts with actual MCP client functionality
 */

// MCP SDK imports - these will be available after npm install
// @ts-ignore - Optional dependency until installed
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// @ts-ignore
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// @ts-ignore
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { getSettings, saveSettings } from './memory';

export interface StrataConnection {
  appName: string;
  connected: boolean;
  serverUrl?: string;
  authToken?: string;
  lastError?: string;
  connectedAt?: string;
}

export interface StrataActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface McpServerConfig {
  appName: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  websocketUrl?: string;
  sseUrl?: string;
}

// Built-in MCP server configurations for popular apps
const BUILT_IN_MCP_SERVERS: Record<string, McpServerConfig> = {
  'GitHub': {
    appName: 'GitHub',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {},
  },
  'GitLab': {
    appName: 'GitLab',
    websocketUrl: 'wss://gitlab.com/api/v4/mcp/websocket',
  },
  'Slack': {
    appName: 'Slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: {},
  },
  'Notion': {
    appName: 'Notion',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-notion'],
    env: {},
  },
  'Airtable': {
    appName: 'Airtable',
    websocketUrl: 'wss://api.airtable.com/v0/mcp',
  },
  'Linear': {
    appName: 'Linear',
    websocketUrl: 'wss://api.linear.app/mcp',
  },
  'Figma': {
    appName: 'Figma',
    websocketUrl: 'wss://api.figma.com/v1/mcp',
  },
  'Vercel': {
    appName: 'Vercel',
    command: 'npx',
    args: ['-y', 'vercel-mcp-server'],
    env: {},
  },
  'Supabase': {
    appName: 'Supabase',
    command: 'npx',
    args: ['-y', '@supabase/mcp-server-supabase'],
    env: {},
  },
  'Brave Search': {
    appName: 'Brave Search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: {},
  },
  'PostgreSQL': {
    appName: 'PostgreSQL',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: {},
  },
  'SQLite': {
    appName: 'SQLite',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    env: {},
  },
};

class StrataMcpClient {
  private clients: Map<string, Client> = new Map();
  private connections: Map<string, StrataConnection> = new Map();
  private transports: Map<string, StdioClientTransport | WebSocketClientTransport> = new Map();

  constructor() {
    this.loadConnections();
  }

  private loadConnections(): void {
    try {
      const settings = getSettings();
      const savedConnections = settings.strataConnections;
      if (savedConnections) {
        const parsed = JSON.parse(String(savedConnections));
        for (const [appName, conn] of Object.entries(parsed)) {
          this.connections.set(appName, conn as StrataConnection);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  private saveConnections(): void {
    const settings = getSettings();
    const connectionsObj: Record<string, StrataConnection> = {};
    for (const [appName, conn] of this.connections) {
      connectionsObj[appName] = conn;
    }
    settings.strataConnections = JSON.stringify(connectionsObj);
    saveSettings(settings);
  }

  /** Get list of apps that can be connected via MCP */
  listAvailableApps(): string[] {
    return Object.keys(BUILT_IN_MCP_SERVERS);
  }

  /** Get current connection status for all apps */
  getAllConnections(): StrataConnection[] {
    const availableApps = this.listAvailableApps();
    return availableApps.map(appName => {
      const existing = this.connections.get(appName);
      return existing || { appName, connected: false };
    });
  }

  /** Check if specific app is connected */
  isConnected(appName: string): boolean {
    const conn = this.connections.get(appName);
    return conn?.connected ?? false;
  }

  /** Get connection details */
  getConnection(appName: string): StrataConnection | undefined {
    return this.connections.get(appName);
  }

  /**
   * Connect to an MCP server for a specific app.
   * For built-in apps, automatically configures the appropriate MCP server.
   * For custom apps, requires serverUrl or command configuration.
   */
  async connect(appName: string, config?: {
    apiKey?: string;
    serverUrl?: string;
    customCommand?: string;
    customArgs?: string[];
  }): Promise<StrataConnection> {
    // Disconnect if already connected
    if (this.clients.has(appName)) {
      await this.disconnect(appName);
    }

    const serverConfig = BUILT_IN_MCP_SERVERS[appName];
    if (!serverConfig && !config?.serverUrl && !config?.customCommand) {
      const errorConn: StrataConnection = {
        appName,
        connected: false,
        lastError: `No built-in MCP server for ${appName}. Provide serverUrl or customCommand.`,
      };
      this.connections.set(appName, errorConn);
      this.saveConnections();
      return errorConn;
    }

    try {
      let transport: StdioClientTransport | WebSocketClientTransport;

      if (config?.serverUrl) {
        // Use WebSocket transport for remote MCP servers
        transport = new WebSocketClientTransport(new URL(config.serverUrl));
      } else if (serverConfig?.websocketUrl) {
        transport = new WebSocketClientTransport(new URL(serverConfig.websocketUrl));
      } else if (config?.customCommand) {
        // Use custom command
        transport = new StdioClientTransport({
          command: config.customCommand,
          args: config.customArgs || [],
          env: { ...process.env, ...(config.apiKey ? { API_KEY: config.apiKey } : {}) } as Record<string, string>,
        });
      } else if (serverConfig?.command) {
        // Use built-in server config
        const env: Record<string, string> = {};
        // Copy process.env, filtering out undefined values
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) {
            env[key] = value;
          }
        }
        if (config?.apiKey) {
          // Map common API key names
          const envVarName = this.getApiKeyEnvVar(appName);
          env[envVarName] = config.apiKey;
        }
        
        transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args || [],
          env,
        });
      } else {
        throw new Error(`No transport configuration available for ${appName}`);
      }

      const client = new Client(
        { name: `bron-${appName.toLowerCase()}-client`, version: '1.0.0' },
        { capabilities: { experimental: {}, sampling: {} } }
      );

      await client.connect(transport);

      this.clients.set(appName, client);
      this.transports.set(appName, transport);

      const connection: StrataConnection = {
        appName,
        connected: true,
        serverUrl: config?.serverUrl || serverConfig?.websocketUrl,
        connectedAt: new Date().toISOString(),
      };
      this.connections.set(appName, connection);
      this.saveConnections();

      return connection;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedConn: StrataConnection = {
        appName,
        connected: false,
        lastError: errorMessage,
      };
      this.connections.set(appName, failedConn);
      this.saveConnections();
      return failedConn;
    }
  }

  /** Disconnect from an MCP server */
  async disconnect(appName: string): Promise<void> {
    const client = this.clients.get(appName);
    const transport = this.transports.get(appName);

    if (client) {
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
      this.clients.delete(appName);
    }

    if (transport) {
      try {
        await transport.close();
      } catch {
        // Ignore close errors
      }
      this.transports.delete(appName);
    }

    const existing = this.connections.get(appName);
    if (existing) {
      existing.connected = false;
      existing.connectedAt = undefined;
      this.saveConnections();
    }
  }

  /** Discover available tools/categories for a connected app */
  async discoverTools(appName: string): Promise<Array<{
    name: string;
    description: string;
    inputSchema: unknown;
  }> | undefined> {
    const client = this.clients.get(appName);
    if (!client) return undefined;

    try {
      const tools = await client.listTools();
      return tools.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema,
      }));
    } catch (error) {
      console.error(`Failed to list tools for ${appName}:`, error);
      return undefined;
    }
  }

  /** Execute an action on a connected app */
  async executeAction(
    appName: string,
    actionName: string,
    params: Record<string, unknown>
  ): Promise<StrataActionResult> {
    const client = this.clients.get(appName);
    if (!client) {
      return { success: false, error: `Not connected to ${appName}. Call connect() first.` };
    }

    try {
      const result = await client.callTool({
        name: actionName,
        arguments: params,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /** Get appropriate environment variable name for API keys */
  private getApiKeyEnvVar(appName: string): string {
    const envVarMap: Record<string, string> = {
      'GitHub': 'GITHUB_PERSONAL_ACCESS_TOKEN',
      'Slack': 'SLACK_BOT_TOKEN',
      'Notion': 'NOTION_API_TOKEN',
      'Linear': 'LINEAR_API_KEY',
      'Figma': 'FIGMA_ACCESS_TOKEN',
      'Vercel': 'VERCEL_TOKEN',
      'Supabase': 'SUPABASE_ACCESS_TOKEN',
      'Brave Search': 'BRAVE_API_KEY',
      'PostgreSQL': 'DATABASE_URL',
      'SQLite': 'DATABASE_PATH',
    };
    return envVarMap[appName] || `${appName.toUpperCase().replace(/\s+/g, '_')}_API_KEY`;
  }

  /** Mark an app as declined (user chose not to connect) */
  markDeclined(appName: string): void {
    const existing = this.connections.get(appName);
    if (existing) {
      existing.connected = false;
    } else {
      this.connections.set(appName, { appName, connected: false });
    }
    this.saveConnections();
  }

  /** Clean up all connections on app exit */
  async disconnectAll(): Promise<void> {
    for (const appName of this.clients.keys()) {
      await this.disconnect(appName);
    }
  }
}

// Singleton instance
export const strataMcp = new StrataMcpClient();

// Legacy compatibility layer — maps old strata.ts interface to new MCP implementation
export async function initializeStrataIntegration(): Promise<void> {
  // Auto-reconnect previously connected apps
  for (const conn of strataMcp.getAllConnections()) {
    if (conn.connected) {
      // Attempt reconnect but don't fail on error
      await strataMcp.connect(conn.appName).catch(() => {
        console.log(`Auto-reconnect failed for ${conn.appName}`);
      });
    }
  }
}
