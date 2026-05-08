export interface ConnectedApp {
  name: string;
  connected: boolean;
  declined: boolean;
}

export interface StrataAction {
  appName: string;
  category: string;
  action: string;
  description?: string;
}

const AVAILABLE_APPS = [
  'Gmail',
  'Google Calendar',
  'Google Docs',
  'Google Drive',
  'Google Sheets',
  'Slack',
  'LinkedIn',
  'Notion',
  'Airtable',
  'Confluence',
  'GitHub',
  'GitLab',
  'Linear',
  'Jira',
  'Figma',
  'Salesforce',
  'ClickUp',
  'Asana',
  'Monday',
  'Microsoft Teams',
  'Outlook Mail',
  'Outlook Calendar',
  'Supabase',
  'Vercel',
  'Postman',
  'Stripe',
  'Cloudflare',
  'Dropbox',
  'OneDrive',
  'WordPress',
  'YouTube',
  'Box',
  'HubSpot',
  'Discord',
  'WhatsApp',
  'Shopify',
  'Zendesk',
  'Intercom',
];

export class StrataIntegration {
  private readonly connectedApps = new Set<string>();
  private readonly declinedApps = new Set<string>();

  listAvailableApps(): string[] {
    return [...AVAILABLE_APPS];
  }

  getConnections(): ConnectedApp[] {
    return AVAILABLE_APPS.map((name) => ({
      name,
      connected: this.connectedApps.has(name),
      declined: this.declinedApps.has(name),
    }));
  }

  setConnected(appName: string, connected = true): void {
    if (!AVAILABLE_APPS.includes(appName)) return;
    if (connected) {
      this.connectedApps.add(appName);
      this.declinedApps.delete(appName);
      return;
    }
    this.connectedApps.delete(appName);
  }

  markDeclined(appName: string): void {
    if (!AVAILABLE_APPS.includes(appName)) return;
    this.declinedApps.add(appName);
    this.connectedApps.delete(appName);
  }

  async checkConnection(appName: string): Promise<boolean> {
    return this.connectedApps.has(appName);
  }

  async discoverActions(_appName: string, _query: string): Promise<StrataAction[]> {
    // Placeholder until MCP/Strata adapter is wired.
    return [];
  }

  async executeAction(
    _appName: string,
    _category: string,
    _action: string,
    _params: Record<string, unknown>,
  ): Promise<unknown> {
    throw new Error('Strata execution is not wired yet.');
  }
}

export const strata = new StrataIntegration();
