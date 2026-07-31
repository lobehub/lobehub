// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstallationCredentials } from './installations/types';

const mocks = vi.hoisted(() => ({
  createDMChannel: vi.fn(),
  createMessage: vi.fn(),
  postMessage: vi.fn(),
  sendTelegramMessage: vi.fn(),
}));

vi.mock('@/server/services/bot/platforms/telegram/api', () => ({
  TelegramApi: class {
    sendMessage = mocks.sendTelegramMessage;
  },
}));

vi.mock('@/server/services/bot/platforms/discord/api', () => ({
  DiscordApi: class {
    createDMChannel = mocks.createDMChannel;
    createMessage = mocks.createMessage;
  },
}));

vi.mock('@/server/services/bot/platforms/slack/api', () => ({
  SlackApi: class {
    postMessage = mocks.postMessage;
  },
}));

const { sendOutboundDirectMessage } = await import('./outbound');

const creds = (platform: string): InstallationCredentials =>
  ({
    applicationId: 'app-1',
    botToken: 'token-1',
    installationKey: `${platform}:singleton`,
    metadata: {},
    platform,
    tenantId: '',
  }) as InstallationCredentials;

describe('sendOutboundDirectMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDMChannel.mockResolvedValue({ id: 'dm-channel-1' });
  });

  it('sends a Telegram message straight to the chat id', async () => {
    await sendOutboundDirectMessage({
      content: 'hello',
      credentials: creds('telegram'),
      platformUserId: '12345',
    });

    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith('12345', 'hello');
  });

  it('opens a Discord DM channel before posting', async () => {
    await sendOutboundDirectMessage({
      content: 'hello',
      credentials: creds('discord'),
      platformUserId: 'U-discord',
    });

    expect(mocks.createDMChannel).toHaveBeenCalledWith('U-discord');
    expect(mocks.createMessage).toHaveBeenCalledWith('dm-channel-1', 'hello');
  });

  it('posts to a Slack user id, which Slack resolves to their DM', async () => {
    await sendOutboundDirectMessage({
      content: 'hello',
      credentials: creds('slack'),
      platformUserId: 'U-slack',
    });

    expect(mocks.postMessage).toHaveBeenCalledWith('U-slack', 'hello');
  });

  // WeChat is windowed and never reaches this module — `sendMessengerPush`
  // routes it to `wechatPush` first. Failing loudly keeps a future platform
  // from silently going nowhere.
  it('throws for a platform without an outbound implementation', async () => {
    await expect(
      sendOutboundDirectMessage({
        content: 'hello',
        credentials: creds('wechat'),
        platformUserId: 'U-wechat',
      }),
    ).rejects.toThrow('wechat');
  });

  it('propagates platform failures so the caller can map them to `unavailable`', async () => {
    mocks.sendTelegramMessage.mockRejectedValueOnce(new Error('bot blocked by user'));

    await expect(
      sendOutboundDirectMessage({
        content: 'hello',
        credentials: creds('telegram'),
        platformUserId: '12345',
      }),
    ).rejects.toThrow('bot blocked by user');
  });
});
