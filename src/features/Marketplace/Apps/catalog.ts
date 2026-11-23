import type {
  ConnectorCatalogItem,
  ConnectorCategory,
  OfficialMcpServerType,
} from '@lobechat/const';
import { CONNECTOR_CATEGORIES, getConnectorCategory } from '@lobechat/const';
import qs from 'query-string';

import type { MessengerPlatformItem } from '@/store/messenger/projection';

import { marketplaceAppPath } from '../paths';

export const appCategories = CONNECTOR_CATEGORIES;
type AppCategory = ConnectorCategory;

export interface MarketplaceApp {
  category: AppCategory;
  channel?: MessengerPlatformItem;
  channelLinked: boolean;
  channelPending: boolean;
  id: string;
  integrationConnected: boolean;
  name: string;
  /** A vendor's official remote MCP server, connected as a regular connector. */
  officialMcp?: OfficialMcpServerType;
  tool?: ConnectorCatalogItem;
  toolConnected: boolean;
}

/** An Apps path with its query; empty values are left out. */
export const appUrl = (path: string, query: Record<string, string | undefined>) =>
  qs.stringifyUrl({ query, url: path }, { skipEmptyString: true, skipNull: true });

/** A category shows this many apps (four two-column rows) until "View all" opens its page. */
export const CATEGORY_PREVIEW_COUNT = 8;

/** Whether `value` names one of the catalog's categories (a `?category=` link). */
export const isAppCategory = (value: string | null | undefined): value is AppCategory =>
  !!value && (appCategories as readonly string[]).includes(value);

export type { AppCategory };

/**
 * Who makes the app itself, shown as its developer. The catalog's own author is
 * whoever built the integration (LobeHub, Composio), which would read as the
 * app's maker on a detail page, so it moves to the "Integrated by" row.
 */
const VENDOR_BY_ID: Record<string, { name: string; url: string }> = {
  'airtable': { name: 'Airtable', url: 'https://www.airtable.com' },
  'cal-com': { name: 'Cal.com', url: 'https://cal.com' },
  'clickup': { name: 'ClickUp', url: 'https://clickup.com' },
  'confluence': { name: 'Atlassian', url: 'https://www.atlassian.com/software/confluence' },
  'discord': { name: 'Discord', url: 'https://discord.com' },
  'dropbox': { name: 'Dropbox', url: 'https://www.dropbox.com' },
  'figma': { name: 'Figma', url: 'https://www.figma.com' },
  'github': { name: 'GitHub', url: 'https://github.com' },
  'gmail': { name: 'Google', url: 'https://mail.google.com' },
  'google-calendar': { name: 'Google', url: 'https://calendar.google.com' },
  'google-docs': { name: 'Google', url: 'https://docs.google.com' },
  'google-drive': { name: 'Google', url: 'https://drive.google.com' },
  'google-sheets': { name: 'Google', url: 'https://sheets.google.com' },
  'hubspot': { name: 'HubSpot', url: 'https://www.hubspot.com' },
  'jira': { name: 'Atlassian', url: 'https://www.atlassian.com/software/jira' },
  'linear': { name: 'Linear', url: 'https://linear.app' },
  'microsoft': { name: 'Microsoft', url: 'https://www.microsoft.com' },
  'notion': { name: 'Notion', url: 'https://www.notion.com' },
  'onedrive': { name: 'Microsoft', url: 'https://onedrive.live.com' },
  'outlook-mail': { name: 'Microsoft', url: 'https://outlook.live.com' },
  'posthog': { name: 'PostHog', url: 'https://posthog.com' },
  'salesforce': { name: 'Salesforce', url: 'https://www.salesforce.com' },
  'slack': { name: 'Slack', url: 'https://slack.com' },
  'supabase': { name: 'Supabase', url: 'https://supabase.com' },
  'telegram': { name: 'Telegram', url: 'https://telegram.org' },
  'twitter': { name: 'X', url: 'https://x.com' },
  'vercel': { name: 'Vercel', url: 'https://vercel.com' },
  'wechat': { name: 'Tencent', url: 'https://www.wechat.com' },
  'whatsapp': { name: 'Meta', url: 'https://www.whatsapp.com' },
  'youtube': { name: 'Google', url: 'https://www.youtube.com' },
  'zendesk': { name: 'Zendesk', url: 'https://www.zendesk.com' },
};

export interface AppFacts {
  /** Who built the integration; absent when it is the vendor itself. */
  integrator?: string;
  vendor: string;
  vendorUrl?: string;
}

/** The "Information" card's maker rows: the app's vendor, then who integrated it. */
export const getAppFacts = (app: Pick<MarketplaceApp, 'id' | 'name' | 'tool'>): AppFacts => {
  const integrator =
    app.tool?.type === 'composio'
      ? 'Composio'
      : app.tool?.type === 'lobehub'
        ? 'LobeHub'
        : undefined;
  const vendor = VENDOR_BY_ID[app.id];
  if (!vendor) return { vendor: integrator ?? app.name };
  return {
    integrator: integrator && integrator !== vendor.name ? integrator : undefined,
    vendor: vendor.name,
    vendorUrl: vendor.url,
  };
};

export const hasAppConnection = (app: MarketplaceApp) =>
  app.channelLinked || app.toolConnected || app.integrationConnected;

// A channel needs its own setup screen, even when the same app also provides tools.
export const getInlineConnectTool = (app: MarketplaceApp, lobehubEnabled: boolean) => {
  if (app.channel || hasAppConnection(app)) return;
  if (app.tool?.type === 'lobehub' && !lobehubEnabled) return;
  return app.tool;
};

export const getAppHome = (app: MarketplaceApp) => {
  const path = marketplaceAppPath(app.id);
  return app.channel && app.toolConnected && !app.channelLinked ? `${path}?capability=tools` : path;
};

export const buildMarketplaceApps = ({
  channels,
  isToolConnected,
  integrationConnected,
  installedChannels,
  linkedChannels,
  officialMcpServers = [],
  isOfficialMcpConnected = () => false,
  tools,
}: {
  channels: readonly MessengerPlatformItem[];
  isToolConnected: (tool: ConnectorCatalogItem) => boolean;
  integrationConnected: (id: string) => boolean;
  installedChannels: ReadonlySet<string>;
  isOfficialMcpConnected?: (identifier: string) => boolean;
  linkedChannels: ReadonlySet<string>;
  officialMcpServers?: readonly OfficialMcpServerType[];
  tools: readonly ConnectorCatalogItem[];
}): MarketplaceApp[] => {
  const apps = new Map<string, MarketplaceApp>();
  for (const tool of tools) {
    const id = tool.type === 'lobehub' ? tool.provider.id : tool.serverType.identifier;
    const name = tool.type === 'lobehub' ? tool.provider.label : tool.serverType.label;
    apps.set(id, {
      category: getConnectorCategory(id),
      channelLinked: false,
      channelPending: false,
      id,
      name,
      integrationConnected: integrationConnected(id),
      tool,
      toolConnected: isToolConnected(tool),
    });
  }

  // Official servers never replace a LobeHub or Composio entry of the same app
  for (const server of officialMcpServers) {
    if (apps.has(server.identifier)) continue;
    apps.set(server.identifier, {
      category: server.category,
      channelLinked: false,
      channelPending: false,
      id: server.identifier,
      integrationConnected: false,
      name: server.label,
      officialMcp: server,
      toolConnected: isOfficialMcpConnected(server.identifier),
    });
  }

  for (const channel of channels) {
    const app = apps.get(channel.id);
    const linked = linkedChannels.has(channel.id);
    const installed = installedChannels.has(channel.id);
    apps.set(channel.id, {
      ...app,
      category: 'communication',
      channel,
      channelLinked: linked && (channel.id !== 'wechat' || installed),
      channelPending: installed && !linked,
      id: channel.id,
      name: channel.name,
      integrationConnected: false,
      toolConnected: app?.toolConnected ?? false,
    });
  }

  return [...apps.values()];
};
