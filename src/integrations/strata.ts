/**
 * Strata Integration Module
 * Provides connectivity to external apps via MCP (Model Context Protocol)
 * 
 * This module bridges Bron with various external services like:
 * - GitHub, GitLab, Linear (developer tools)
 * - Notion, Airtable (databases)
 * - Slack, Discord (communication)
 * - and more...
 */

import {
  strataMcp,
  StrataConnection,
  StrataActionResult,
  initializeStrataIntegration,
} from '../main/strataMcp';

export type { StrataConnection, StrataActionResult };

export interface ConnectedApp {
  name: string;
  connected: boolean;
  declined: boolean;
  error?: string;
}

export interface StrataAction {
  appName: string;
  category: string;
  action: string;
  description?: string;
}

// Re-export the initialization function
export { initializeStrataIntegration };

/**
 * Get list of all available apps that can be connected via MCP
 */
export function listAvailableApps(): string[] {
  return strataMcp.listAvailableApps();
}

/**
 * Get connection status for all available apps
 */
export function getConnections(): ConnectedApp[] {
  const connections = strataMcp.getAllConnections();
  return connections.map(conn => ({
    name: conn.appName,
    connected: conn.connected,
    declined: false, // MCP doesn't track decline separately
    error: conn.lastError,
  }));
}

/**
 * Check if a specific app is currently connected
 */
export async function checkConnection(appName: string): Promise<boolean> {
  return strataMcp.isConnected(appName);
}

/**
 * Connect to an external app via MCP
 * 
 * @param appName — Name of the app (e.g., 'GitHub', 'Slack', 'Notion')
 * @param apiKey — API key or token for the service
 * @returns Connection result with status
 */
export async function connectApp(
  appName: string,
  apiKey: string
): Promise<StrataConnection> {
  return strataMcp.connect(appName, { apiKey });
}

/**
 * Disconnect from an external app
 */
export async function disconnectApp(appName: string): Promise<void> {
  return strataMcp.disconnect(appName);
}

/**
 * Discover available actions/tools for a connected app
 * 
 * @returns List of available actions or undefined if not connected
 */
export async function discoverActions(appName: string): Promise<Array<{
  name: string;
  description: string;
  inputSchema: unknown;
}> | undefined> {
  return strataMcp.discoverTools(appName);
}

/**
 * Execute an action on a connected app
 * 
 * @param appName — Connected app name
 * @param action — Action name/tool to call
 * @param params — Parameters for the action
 * @returns Result of the action
 */
export async function executeAction(
  appName: string,
  action: string,
  params: Record<string, unknown>
): Promise<StrataActionResult> {
  return strataMcp.executeAction(appName, action, params);
}

/**
 * Legacy compatibility: Mark an app as declined (user chose not to connect)
 * In MCP mode, this just disconnects and clears any saved tokens
 */
export function markDeclined(appName: string): void {
  strataMcp.markDeclined(appName);
}

/**
 * Search documentation for available capabilities
 * Returns actions that match the query across all apps
 */
export async function searchDocumentation(query: string): Promise<Array<{
  appName: string;
  action: string;
  description: string;
}>> {
  const results: Array<{ appName: string; action: string; description: string }> = [];
  
  // For each connected app, get its tools and filter by query
  for (const conn of strataMcp.getAllConnections()) {
    if (!conn.connected) continue;
    
    const tools = await strataMcp.discoverTools(conn.appName);
    if (!tools) continue;
    
    const queryLower = query.toLowerCase();
    for (const tool of tools) {
      if (
        tool.name.toLowerCase().includes(queryLower) ||
        tool.description.toLowerCase().includes(queryLower)
      ) {
        results.push({
          appName: conn.appName,
          action: tool.name,
          description: tool.description,
        });
      }
    }
  }
  
  return results;
}

/**
 * Get connection instructions for an app
 * Returns helpful setup instructions for apps that require configuration
 */
export function getConnectionInstructions(appName: string): string {
  const instructions: Record<string, string> = {
    'GitHub': `To connect GitHub:
1. Go to https://github.com/settings/tokens
2. Generate a new personal access token with repo scope
3. Paste the token when connecting`,

    'Slack': `To connect Slack:
1. Go to https://api.slack.com/apps
2. Create a new app or use existing
3. Add OAuth scopes: chat:write, channels:read
4. Install the app to your workspace
5. Copy the Bot User OAuth Token`,

    'Notion': `To connect Notion:
1. Go to https://www.notion.so/my-integrations
2. Create a new integration
3. Copy the Internal Integration Token
4. Share specific pages with your integration`,

    'Linear': `To connect Linear:
1. Go to https://linear.app/settings/api
2. Create a new personal API key
3. Copy the key and paste it here`,

    'Vercel': `To connect Vercel:
1. Go to https://vercel.com/account/tokens
2. Create a new token
3. Copy the token and paste it here`,

    'Supabase': `To connect Supabase:
1. Go to your Supabase project settings
2. Navigate to API section
3. Copy the service_role key (or anon key for limited access)`,

    'Brave Search': `To connect Brave Search:
1. Go to https://api.search.brave.com/app/keys
2. Create a new API key
3. Copy the key and paste it here`,
  };

  return instructions[appName] || `To connect ${appName}:\n1. Obtain an API key from the service\n2. Paste it when prompted`;
}

/**
 * Clean up all connections on app exit
 */
export async function disconnectAll(): Promise<void> {
  return strataMcp.disconnectAll();
}

// Legacy re-exports for backward compatibility
export const strata = strataMcp;
