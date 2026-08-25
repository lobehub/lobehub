// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { getMessengerPushWindow, MESSENGER_PUSH_PLATFORMS, sendMessengerPush } from './index';

const mocks = vi.hoisted(() => ({
  findByPlatform: vi.fn(),
  getWechatPushWindowStatus: vi.fn(),
  list: vi.fn(),
  resolveByKey: vi.fn(),
  sendDirectMessage: vi.fn(),
  sendProactiveWechatMessage: vi.fn(),
}));

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: class {
    findByPlatform = mocks.findByPlatform;
    list = mocks.list;
  },
}));

vi.mock('@/server/services/messenger/installations', () => ({
  getInstallationStore: () => ({ resolveByKey: mocks.resolveByKey }),
}));

vi.mock('@/server/services/messenger/outbound', () => ({
  sendOutboundDirectMessage: mocks.sendDirectMessage,
}));

vi.mock('@/server/services/messenger/wechatPush', () => ({
  getWechatPushWindowStatus: mocks.getWechatPushWindowStatus,
  sendProactiveWechatMessage: mocks.sendProactiveWechatMessage,
}));

const serverDB = { kind: 'db' } as unknown as LobeChatDatabase;

const buildLink = (platform: 'discord' | 'slack' | 'telegram', tenantId = '') => ({
  id: `link-${platform}-${tenantId}`,
  platform,
  platformUserId: `${platform}-user`,
  tenantId,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveByKey.mockImplementation(async (installationKey: string) => ({
    applicationId: installationKey,
    botToken: 'token',
    installationKey,
    metadata: {},
    platform: installationKey.split(':')[0],
    tenantId: installationKey.split(':')[1] === 'singleton' ? '' : installationKey.split(':')[1],
  }));
  mocks.sendDirectMessage.mockResolvedValue(undefined);
  mocks.getWechatPushWindowStatus.mockResolvedValue({
    expiresInSeconds: 3600,
    linked: true,
    maxSends: 10,
    queued: 0,
    remaining: 9,
    windowOpen: true,
  });
  mocks.sendProactiveWechatMessage.mockResolvedValue({ remaining: 9, status: 'sent' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('messenger proactive push', () => {
  it('exposes every currently supported System Bot platform', () => {
    expect(MESSENGER_PUSH_PLATFORMS).toEqual(['telegram', 'slack', 'discord', 'wechat']);
  });

  it.each([
    ['telegram', 'telegram:singleton'],
    ['discord', 'discord:singleton'],
    ['slack', 'slack:T_ACME'],
  ] as const)(
    'sends an always-available %s DM with the resolved installation',
    async (platform, key) => {
      const tenantId = platform === 'slack' ? 'T_ACME' : '';
      const link = buildLink(platform, tenantId);
      mocks.findByPlatform.mockResolvedValue(link);

      const result = await sendMessengerPush({
        content: '  deployment complete  ',
        platform,
        serverDB,
        tenantId: tenantId || undefined,
        userId: 'user-1',
      });

      expect(result).toEqual({ status: 'sent' });
      expect(mocks.resolveByKey).toHaveBeenCalledWith(key);
      expect(mocks.sendDirectMessage).toHaveBeenCalledWith({
        content: 'deployment complete',
        credentials: expect.objectContaining({ installationKey: key }),
        platformUserId: link.platformUserId,
      });
    },
  );

  it('forwards attachments to the outbound DM and allows an empty text leg', async () => {
    const link = buildLink('slack', 'T_ACME');
    mocks.findByPlatform.mockResolvedValue(link);
    const attachments = [
      { fetchUrl: 'https://cdn.example.com/report.pdf', name: 'report.pdf', type: 'file' as const },
    ];

    const result = await sendMessengerPush({
      attachments,
      platform: 'slack',
      serverDB,
      tenantId: 'T_ACME',
      userId: 'user-1',
    });

    expect(result).toEqual({ status: 'sent' });
    expect(mocks.sendDirectMessage).toHaveBeenCalledWith({
      attachments,
      content: undefined,
      credentials: expect.objectContaining({ installationKey: 'slack:T_ACME' }),
      platformUserId: link.platformUserId,
    });
  });

  it('uses tenantId to route a Slack push to the requested workspace link', async () => {
    mocks.findByPlatform.mockResolvedValue(buildLink('slack', 'T_BETA'));

    await sendMessengerPush({
      content: 'hello beta',
      platform: 'slack',
      serverDB,
      tenantId: 'T_BETA',
      userId: 'user-1',
    });

    expect(mocks.findByPlatform).toHaveBeenCalledWith('slack', 'T_BETA');
    expect(mocks.resolveByKey).toHaveBeenCalledWith('slack:T_BETA');
  });

  it('does not guess a Slack target when several workspaces are linked', async () => {
    mocks.list.mockResolvedValue([buildLink('slack', 'T_ACME'), buildLink('slack', 'T_BETA')]);

    const result = await sendMessengerPush({
      content: 'ambiguous',
      platform: 'slack',
      serverDB,
      userId: 'user-1',
    });

    expect(result).toEqual({ status: 'unlinked' });
    expect(mocks.resolveByKey).not.toHaveBeenCalled();
    expect(mocks.sendDirectMessage).not.toHaveBeenCalled();
  });

  it('reports an unavailable platform when the installation cannot be resolved', async () => {
    mocks.findByPlatform.mockResolvedValue(buildLink('telegram'));
    mocks.resolveByKey.mockResolvedValue(null);

    const result = await sendMessengerPush({
      content: 'hello',
      platform: 'telegram',
      serverDB,
      userId: 'user-1',
    });

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('reports an unavailable platform when opening or posting the DM fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.findByPlatform.mockResolvedValue(buildLink('discord'));
    mocks.sendDirectMessage.mockRejectedValue(new Error('DMs disabled'));

    const result = await sendMessengerPush({
      content: 'hello',
      platform: 'discord',
      serverDB,
      userId: 'user-1',
    });

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('reports always-open status for a linked non-windowed platform', async () => {
    mocks.findByPlatform.mockResolvedValue(buildLink('telegram'));

    const status = await getMessengerPushWindow({
      platform: 'telegram',
      serverDB,
      userId: 'user-1',
    });

    expect(status).toEqual({
      deliverability: 'always',
      expiresInSeconds: null,
      linked: true,
      maxSends: 0,
      queued: 0,
      remaining: 0,
      windowOpen: true,
    });
  });

  it('preserves WeChat windowed delivery semantics', async () => {
    const status = await getMessengerPushWindow({
      platform: 'wechat',
      serverDB,
      userId: 'user-1',
    });
    const result = await sendMessengerPush({
      content: 'hello',
      platform: 'wechat',
      serverDB,
      userId: 'user-1',
    });

    expect(status).toMatchObject({ deliverability: 'windowed', remaining: 9, windowOpen: true });
    expect(result).toEqual({ remaining: 9, status: 'sent' });
  });
});
