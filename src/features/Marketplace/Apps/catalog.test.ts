import { getConnectorCatalog } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import type { MessengerPlatformItem } from '@/store/messenger/projection';

import { buildMarketplaceApps, getInlineConnectTool, hasAppConnection } from './catalog';

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
      category: 'chat',
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
    expect(toolsOnly.find((app) => app.id === 'slack')?.category).toBe('chat');
    expect(toolsOnly.find((app) => app.id === 'whatsapp')?.category).toBe('chat');
    expect(toolsOnly.every((app) => !app.channel)).toBe(true);
  });
});
