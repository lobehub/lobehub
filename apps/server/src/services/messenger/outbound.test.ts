// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstallationCredentials } from './installations/types';

// Attachments in these fixtures carry no `size`, so the budget pass probes the
// URL for one. These tests are about delivery mechanics, not budgeting — answer
// the probe with a small, in-budget length. The probe's own behaviour is
// covered in attachmentBudget.test.ts.
vi.mock('@/server/services/bot/platforms/publicUrlFetch', () => ({
  fetchPublicUrl: async () => ({
    dispose: async () => undefined,
    response: { headers: new Headers({ 'content-length': '1024' }), ok: true, status: 200 },
  }),
}));

const mocks = vi.hoisted(() => ({
  batchDiscordFiles: vi.fn(),
  createDMChannel: vi.fn(),
  createMessage: vi.fn(),
  materializeAttachmentsForDiscord: vi.fn(),
  openConversation: vi.fn(),
  postMessage: vi.fn(),
  sendSlackAttachments: vi.fn(),
  sendTelegramAttachments: vi.fn(),
  sendTelegramMessage: vi.fn(),
}));

vi.mock('@/server/services/bot/platforms/telegram/api', () => ({
  TelegramApi: class {
    sendMessage = mocks.sendTelegramMessage;
  },
}));

vi.mock('@/server/services/bot/platforms/telegram/sendAttachments', () => ({
  sendTelegramAttachments: mocks.sendTelegramAttachments,
}));

vi.mock('@/server/services/bot/platforms/discord/api', () => ({
  DiscordApi: class {
    createDMChannel = mocks.createDMChannel;
    createMessage = mocks.createMessage;
  },
}));

vi.mock('@/server/services/bot/platforms/discord/sendAttachments', () => ({
  batchDiscordFiles: mocks.batchDiscordFiles,
  materializeAttachmentsForDiscord: mocks.materializeAttachmentsForDiscord,
}));

vi.mock('@/server/services/bot/platforms/slack/api', () => ({
  SlackApi: class {
    openConversation = mocks.openConversation;
    postMessage = mocks.postMessage;
  },
}));

vi.mock('@/server/services/bot/platforms/slack/sendAttachments', () => ({
  sendSlackAttachments: mocks.sendSlackAttachments,
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

const fileAttachment = {
  fetchUrl: 'https://cdn.example.com/report.pdf',
  name: 'report.pdf',
  type: 'file' as const,
};

describe('sendOutboundDirectMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDMChannel.mockResolvedValue({ id: 'dm-channel-1' });
    mocks.openConversation.mockResolvedValue({ id: 'slack-dm-1' });
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

  it('rejects a message with neither content nor attachments', async () => {
    await expect(
      sendOutboundDirectMessage({
        content: '   ',
        credentials: creds('telegram'),
        platformUserId: '12345',
      }),
    ).rejects.toThrow('requires content or attachments');
  });

  describe('attachments', () => {
    it('delivers Telegram attachments with the text as caption, no extra message', async () => {
      mocks.sendTelegramAttachments.mockResolvedValueOnce(1);

      await sendOutboundDirectMessage({
        attachments: [fileAttachment],
        content: 'see attached',
        credentials: creds('telegram'),
        platformUserId: '12345',
      });

      expect(mocks.sendTelegramAttachments).toHaveBeenCalledWith(
        expect.anything(),
        '12345',
        [fileAttachment],
        'see attached',
      );
      expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    });

    it('falls back to a plain Telegram message when every attachment fails', async () => {
      mocks.sendTelegramAttachments.mockResolvedValueOnce(0);

      await sendOutboundDirectMessage({
        attachments: [fileAttachment],
        content: 'see attached',
        credentials: creds('telegram'),
        platformUserId: '12345',
      });

      expect(mocks.sendTelegramMessage).toHaveBeenCalledWith('12345', 'see attached');
    });

    it('throws when Telegram attachments fail and there is no text leg', async () => {
      mocks.sendTelegramAttachments.mockResolvedValueOnce(0);

      await expect(
        sendOutboundDirectMessage({
          attachments: [fileAttachment],
          credentials: creds('telegram'),
          platformUserId: '12345',
        }),
      ).rejects.toThrow('Telegram attachments failed');
    });

    it('sends Discord attachments in batches, text on the first batch only', async () => {
      const rawFiles = [{ name: 'a' }, { name: 'b' }];
      mocks.materializeAttachmentsForDiscord.mockResolvedValueOnce(rawFiles);
      mocks.batchDiscordFiles.mockReturnValueOnce([[rawFiles[0]], [rawFiles[1]]]);

      await sendOutboundDirectMessage({
        attachments: [fileAttachment, fileAttachment],
        content: 'files',
        credentials: creds('discord'),
        platformUserId: 'U-discord',
      });

      expect(mocks.createMessage).toHaveBeenNthCalledWith(1, 'dm-channel-1', 'files', [
        rawFiles[0],
      ]);
      expect(mocks.createMessage).toHaveBeenNthCalledWith(2, 'dm-channel-1', '', [rawFiles[1]]);
    });

    it('opens the Slack DM conversation and uploads via the v2 flow', async () => {
      mocks.sendSlackAttachments.mockResolvedValueOnce(1);

      await sendOutboundDirectMessage({
        attachments: [fileAttachment],
        content: 'files',
        credentials: creds('slack'),
        platformUserId: 'U-slack',
      });

      expect(mocks.openConversation).toHaveBeenCalledWith('U-slack');
      expect(mocks.sendSlackAttachments).toHaveBeenCalledWith(expect.anything(), {
        attachments: [fileAttachment],
        channelId: 'slack-dm-1',
        initialComment: 'files',
      });
      expect(mocks.postMessage).not.toHaveBeenCalled();
    });

    it('falls back to a plain Slack message when every upload fails', async () => {
      mocks.sendSlackAttachments.mockResolvedValueOnce(0);

      await sendOutboundDirectMessage({
        attachments: [fileAttachment],
        content: 'files',
        credentials: creds('slack'),
        platformUserId: 'U-slack',
      });

      expect(mocks.postMessage).toHaveBeenCalledWith('U-slack', 'files');
    });
  });

  describe('size budgets', () => {
    const oversizedFile = {
      fetchUrl: 'https://example.com/f/big.mp4',
      name: 'big.mp4',
      size: 100 * 1024 * 1024,
      type: 'video' as const,
    };

    it('degrades an over-budget Telegram file to a download-link message', async () => {
      await sendOutboundDirectMessage({
        attachments: [oversizedFile],
        content: 'see attached',
        credentials: creds('telegram'),
        platformUserId: '12345',
      });

      // No attachment survives the budget pass, so the sender is never called.
      expect(mocks.sendTelegramAttachments).not.toHaveBeenCalled();
      expect(mocks.sendTelegramMessage).toHaveBeenNthCalledWith(1, '12345', 'see attached');
      expect(mocks.sendTelegramMessage).toHaveBeenNthCalledWith(
        2,
        '12345',
        expect.stringContaining('https://example.com/f/big.mp4'),
      );
    });

    it('delivers a link-only message when an attachment-only push is over budget', async () => {
      await sendOutboundDirectMessage({
        attachments: [oversizedFile],
        credentials: creds('telegram'),
        platformUserId: '12345',
      });

      expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
      expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('big.mp4'),
      );
    });

    it('sends Discord in-budget files and over-budget links in the same push', async () => {
      const rawFiles = [{ name: 'report.pdf' }];
      mocks.materializeAttachmentsForDiscord.mockResolvedValueOnce(rawFiles);
      mocks.batchDiscordFiles.mockReturnValueOnce([rawFiles]);

      await sendOutboundDirectMessage({
        attachments: [fileAttachment, oversizedFile],
        content: 'files',
        credentials: creds('discord'),
        platformUserId: 'U-discord',
      });

      // Only the in-budget attachment reaches the materializer.
      expect(mocks.materializeAttachmentsForDiscord).toHaveBeenCalledWith([fileAttachment]);
      expect(mocks.createMessage).toHaveBeenNthCalledWith(1, 'dm-channel-1', 'files', rawFiles);
      expect(mocks.createMessage).toHaveBeenNthCalledWith(
        2,
        'dm-channel-1',
        expect.stringContaining('https://example.com/f/big.mp4'),
      );
    });
  });
});
