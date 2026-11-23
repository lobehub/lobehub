import { getConnectorCatalog, getConnectorCategory, OFFICIAL_MCP_SERVERS } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import type { MessengerPlatformItem } from '@/store/messenger/projection';

import {
  buildMarketplaceApps,
  getAppFacts,
  getInlineConnectTool,
  hasAppConnection,
  isAppCategory,
} from './catalog';

const slack: MessengerPlatformItem = {
  appId: 'slack-app',
  botUsername: undefined,
  connectionMode: 'webhook',
  enabled: true,
  id: 'slack',
  name: 'Slack',
  platform: 'slack',
};
const inputs = {
  channels: [slack],
  isToolConnected: () => false,
  integrationConnected: () => false,
  installedChannels: new Set<string>(),
  linkedChannels: new Set<string>(),
  tools: getConnectorCatalog({ composio: true, lobehub: true }),
};

describe('marketplace apps', () => {
  it('lists Slack once with both capabilities and a pending personal binding', () => {
    const apps = buildMarketplaceApps({ ...inputs, installedChannels: new Set(['slack']) });
    const matches = apps.filter((app) => app.id === 'slack');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      category: 'communication',
      channel: slack,
      channelPending: true,
      tool: { type: 'composio' },
    });
    expect(hasAppConnection(matches[0])).toBe(false);
  });

  it.each(['tool', 'channel'])('counts only the authorized Slack capability (%s)', (kind) => {
    const ids = new Set(['slack']);
    const apps = buildMarketplaceApps({
      ...inputs,
      ...(kind === 'tool' ? { isToolConnected: () => true } : { linkedChannels: ids }),
    });
    const slackApp = apps.find((app) => app.id === 'slack')!;
    expect(slackApp.channelLinked).toBe(kind === 'channel');
    expect(slackApp.toolConnected).toBe(kind === 'tool');
    expect(hasAppConnection(slackApp)).toBe(true);
  });

  it.each(['github', 'linear'])('counts a %s integration independently of tool OAuth', (id) => {
    const app = buildMarketplaceApps({
      ...inputs,
      integrationConnected: (provider) => provider === id,
    }).find((app) => app.id === id)!;
    expect(app.toolConnected).toBe(false);
    expect(hasAppConnection(app)).toBe(true);
  });

  it('chooses the connect action by capability and provider availability', () => {
    const discord: MessengerPlatformItem = {
      ...slack,
      id: 'discord',
      name: 'Discord',
      platform: 'discord',
    };
    const apps = buildMarketplaceApps({ ...inputs, channels: [slack, discord] });
    const byId = (id: string) => apps.find((app) => app.id === id)!;
    expect(getInlineConnectTool(byId('google-docs'), true)?.type).toBe('composio');
    expect(getInlineConnectTool(byId('posthog'), true)?.type).toBe('lobehub');
    expect(getInlineConnectTool(byId('discord'), true)).toBeUndefined();
    expect(getInlineConnectTool(byId('slack'), true)).toBeUndefined();
    expect(getInlineConnectTool({ ...byId('slack'), channel: undefined }, true)?.type).toBe(
      'composio',
    );
    expect(getInlineConnectTool(byId('whatsapp'), true)?.type).toBe('composio');
    expect(getInlineConnectTool(byId('github'), false)).toBeUndefined();
    expect(
      getInlineConnectTool({ ...byId('google-docs'), toolConnected: true }, true),
    ).toBeUndefined();
  });

  it('lists only the supported capabilities on each deployment', () => {
    const channelOnly = buildMarketplaceApps({ ...inputs, tools: [] });
    expect(channelOnly).toHaveLength(1);
    expect(channelOnly[0].tool).toBeUndefined();
    const toolsOnly = buildMarketplaceApps({ ...inputs, channels: [] });
    expect(toolsOnly.find((app) => app.id === 'slack')?.category).toBe('communication');
    expect(toolsOnly.find((app) => app.id === 'whatsapp')?.category).toBe('communication');
    expect(toolsOnly.every((app) => !app.channel)).toBe(true);
  });

  it('lists official MCP servers without replacing a LobeHub or Composio app', () => {
    const notion = { ...OFFICIAL_MCP_SERVERS[0], identifier: 'notion', label: 'Notion MCP' };
    const apps = buildMarketplaceApps({
      ...inputs,
      isOfficialMcpConnected: (id) => id === 'sentry',
      officialMcpServers: [...OFFICIAL_MCP_SERVERS, notion],
    });
    const notionApps = apps.filter((app) => app.id === 'notion');
    expect(notionApps).toHaveLength(1);
    expect(notionApps[0].tool).toBeDefined();
    expect(notionApps[0].officialMcp).toBeUndefined();
    const sentry = apps.find((app) => app.id === 'sentry')!;
    expect(sentry).toMatchObject({ category: 'coding', toolConnected: true });
    expect(sentry.tool).toBeUndefined();
    expect(hasAppConnection(sentry)).toBe(true);
    expect(getInlineConnectTool(sentry, true)).toBeUndefined();
  });

  it('keeps official MCP identifiers unique and clear of the existing catalogs', () => {
    const ids = OFFICIAL_MCP_SERVERS.map((server) => server.identifier);
    const taken = new Set(
      getConnectorCatalog({ composio: true, lobehub: true }).map((item) =>
        item.type === 'lobehub' ? item.provider.id : item.serverType.identifier,
      ),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => taken.has(id))).toEqual([]);
    for (const server of OFFICIAL_MCP_SERVERS) expect(new URL(server.url).protocol).toBe('https:');
  });

  it('files every LobeHub and Composio app under a named category', () => {
    const uncategorized = getConnectorCatalog({ composio: true, lobehub: true })
      .map((item) => (item.type === 'lobehub' ? item.provider.id : item.serverType.identifier))
      .filter((id) => getConnectorCategory(id) === 'other');
    expect(uncategorized).toEqual([]);
  });
});

describe('getAppFacts', () => {
  it('names the vendor as developer and the integrator apart', () => {
    expect(
      getAppFacts({ id: 'notion', name: 'Notion', tool: { type: 'composio' } as any }),
    ).toEqual({ integrator: 'Composio', vendor: 'Notion', vendorUrl: 'https://www.notion.com' });
  });

  it('falls back to the integrator for an app without a known vendor', () => {
    expect(getAppFacts({ id: 'acme', name: 'Acme', tool: { type: 'lobehub' } as any })).toEqual({
      vendor: 'LobeHub',
    });
  });

  it('names a channel-only app by its vendor', () => {
    expect(getAppFacts({ id: 'telegram', name: 'Telegram' })).toEqual({
      vendor: 'Telegram',
      vendorUrl: 'https://telegram.org',
    });
  });
});

describe('isAppCategory', () => {
  it('accepts catalog categories only', () => {
    expect(isAppCategory('coding')).toBe(true);
    expect(isAppCategory('social')).toBe(false);
    expect(isAppCategory(null)).toBe(false);
  });
});
