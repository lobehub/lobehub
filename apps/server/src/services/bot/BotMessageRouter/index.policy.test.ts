import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockCreateOrGetPairingRequest,
  mockEnsureThreadMember,
  mockFindEnabledByPlatform,
  mockHandleMention,
  mockHandleSubscribedMessage,
  mockOnNewMention,
  mockOnSubscribedMessage,
  resetBotMessageRouterMocks,
} from './testUtils';

vi.mock('@/database/core/db-adaptor', async () => (await import('./testUtils')).dbAdaptorModule());
vi.mock('@/database/models/agentBotProvider', async () =>
  (await import('./testUtils')).agentBotProviderModule(),
);
vi.mock('../dmPairingStore', async () => (await import('./testUtils')).dmPairingStoreModule());
vi.mock('@/server/modules/KeyVaultsEncrypt', async () =>
  (await import('./testUtils')).keyVaultsEncryptModule(),
);
vi.mock('@/server/modules/AgentRuntime/redis', async () =>
  (await import('./testUtils')).redisModule(),
);
vi.mock('@/business/server/bot/featureAccess', async () =>
  (await import('./testUtils')).featureAccessModule(),
);
vi.mock('@/envs/app', async () => (await import('./testUtils')).appModule());
vi.mock('@chat-adapter/state-ioredis', async () =>
  (await import('./testUtils')).stateIoredisModule(),
);
vi.mock('chat', async () => (await import('./testUtils')).chatModule());
vi.mock('../deferredMessages', async () => (await import('./testUtils')).deferredMessagesModule());
vi.mock('../mergeMessages', async (importOriginal) =>
  (await import('./testUtils')).mergeMessagesModule(importOriginal),
);
vi.mock('@/server/services/aiAgent', async () => (await import('./testUtils')).aiAgentModule());
vi.mock('../AgentBridgeService', async () =>
  (await import('./testUtils')).agentBridgeServiceModule(),
);
vi.mock('../platforms', async () => (await import('./testUtils')).platformsModule());

describe('BotMessageRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBotMessageRouterMocks();
  });

  describe('onNewMention DM policy', () => {
    async function loadMentionHandler(settings?: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'app-1',
          settings: settings ?? { dmPolicy: 'open' },
        }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const lastCall = mockOnNewMention.mock.calls.at(-1);
      if (!lastCall) throw new Error('onNewMention was not registered');
      return lastCall[0] as (thread: any, message: any, ctx?: any) => Promise<void>;
    }

    it('should allow group @-mentions regardless of DM policy', async () => {
      const handler = await loadMentionHandler({ dmPolicy: 'disabled' });
      const thread = {
        id: 'telegram:group-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('should block @-mentions inside DMs when DM is disabled and notify the sender', async () => {
      const handler = await loadMentionHandler({ dmPolicy: 'disabled' });
      const thread = {
        id: 'discord:@me:channel-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      };

      await handler(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("isn't accepting direct messages");
    });

    it('should propagate sender + isOwner=true on botContext when the owner @s the bot', async () => {
      const handler = await loadMentionHandler({ dmPolicy: 'open', userId: 'owner-platform-id' });
      const thread = {
        id: 'telegram:group-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'owner-platform-id', userName: 'owner' },
        isMention: true,
        text: '@bot run a tool',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      const opts = mockHandleMention.mock.calls[0][2];
      expect(opts.botContext.senderExternalUserId).toBe('owner-platform-id');
      expect(opts.botContext.isOwner).toBe(true);
    });

    it('should propagate sender + isOwner=false on botContext when an external user @s the bot', async () => {
      const handler = await loadMentionHandler({ dmPolicy: 'open', userId: 'owner-platform-id' });
      const thread = {
        id: 'telegram:group-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'random-user-id', userName: 'random' },
        isMention: true,
        text: '@bot rm -rf',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      const opts = mockHandleMention.mock.calls[0][2];
      expect(opts.botContext.senderExternalUserId).toBe('random-user-id');
      expect(opts.botContext.isOwner).toBe(false);
      expect(opts.botContext.isDeviceTrusted).toBeUndefined();
    });

    it('should mark a sender on the device list as device-trusted on botContext', async () => {
      const handler = await loadMentionHandler({
        deviceAllowFrom: [{ id: 'friend-id', name: 'Ada' }],
        devicePolicy: 'allowlist',
        dmPolicy: 'open',
        userId: 'owner-platform-id',
      });
      const thread = {
        id: 'telegram:group-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'friend-id', userName: 'ada' },
        isMention: true,
        text: '@bot check my build',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      const opts = mockHandleMention.mock.calls[0][2];
      expect(opts.botContext.isOwner).toBe(false);
      expect(opts.botContext.isDeviceTrusted).toBe(true);
    });

    it('should fall back to isOwner=false when settings.userId is missing (fail-closed)', async () => {
      // No `userId` configured on the bot — even a sender who happens to
      // share an ID with the operator can't claim owner status.
      const handler = await loadMentionHandler({ dmPolicy: 'open' });
      const thread = {
        id: 'telegram:group-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'someone', userName: 'someone' },
        isMention: true,
        text: '@bot hi',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      const opts = mockHandleMention.mock.calls[0][2];
      expect(opts.botContext.isOwner).toBe(false);
    });

    it('should block DM @-mentions from users outside the allowlist and notify the sender', async () => {
      const handler = await loadMentionHandler({
        allowFrom: 'bob-id',
        dmPolicy: 'allowlist',
      });
      const thread = {
        id: 'discord:@me:channel-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      };

      await handler(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
    });
  });

  describe('group policy', () => {
    /**
     * Returns the registered onSubscribedMessage and onNewMention handlers so
     * group-policy assertions can drive each entry point with the same
     * fixture.
     */
    async function loadHandlers(settings: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const sub = mockOnSubscribedMessage.mock.calls.at(-1);
      const mention = mockOnNewMention.mock.calls.at(-1);
      if (!sub || !mention) throw new Error('handlers not registered');
      return {
        mention: mention[0] as (thread: any, message: any, ctx?: any) => Promise<void>,
        subscribed: sub[0] as (thread: any, message: any, ctx?: any) => Promise<void>,
      };
    }

    function makeGroupThread(channelId: string) {
      return {
        channelId,
        id: `telegram:${channelId}`,
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
    }

    function makeMentionMessage() {
      return {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      };
    }

    it('blocks @-mentions in groups when group policy is disabled and notifies the sender', async () => {
      const { subscribed } = await loadHandlers({ groupPolicy: 'disabled' });
      const thread = makeGroupThread('channel-1');

      await subscribed(thread, makeMentionMessage());

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("doesn't respond in groups or channels");
    });

    it('blocks @-mentions on the new-mention path when group policy is disabled', async () => {
      const { mention } = await loadHandlers({ groupPolicy: 'disabled' });
      const thread = makeGroupThread('channel-1');

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("doesn't respond in groups or channels");
    });

    it('allows open Telegram Guest Mode summons even when group policy is disabled', async () => {
      const { mention } = await loadHandlers({ groupPolicy: 'disabled' });
      const thread = {
        channelId: '-100123',
        id: 'telegram:guest:-100123',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('allows open Telegram Guest Mode summons that are not on the group allowlist', async () => {
      const { mention } = await loadHandlers({
        groupAllowFrom: 'channel-1',
        groupPolicy: 'allowlist',
      });
      const thread = {
        channelId: '-100999',
        id: 'telegram:guest:-100999',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('blocks Telegram Guest Mode independently when Guest Policy is disabled', async () => {
      const { mention } = await loadHandlers({
        groupPolicy: 'open',
        guestPolicy: 'disabled',
      });
      const thread = {
        channelId: '-100123',
        id: 'telegram:guest:-100123',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post.mock.calls[0][0]).toContain('Guest Mode is disabled');
    });

    it('fails closed when Guest Policy is allowlist and Allowed Users is empty', async () => {
      const { mention } = await loadHandlers({ guestPolicy: 'allowlist' });
      const thread = {
        channelId: '-100123',
        id: 'telegram:guest:-100123',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized to use this bot");
    });

    it('allows listed users under Guest Policy allowlist', async () => {
      const { mention } = await loadHandlers({
        allowFrom: [{ id: 'alice-id' }],
        guestPolicy: 'allowlist',
      });
      const thread = {
        channelId: '-100123',
        id: 'telegram:guest:-100123',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('issues a pairing code to unknown Guest Mode users', async () => {
      mockCreateOrGetPairingRequest.mockResolvedValueOnce({
        code: 'PAIR123',
        status: 'created',
      });
      const { mention } = await loadHandlers({
        guestPolicy: 'pairing',
        userId: 'owner-id',
      });
      const thread = {
        channelId: '-100123',
        id: 'telegram:guest:-100123',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post.mock.calls[0][0]).toContain('PAIR123');
      expect(thread.post.mock.calls[0][0]).toContain('Guest Mode');
    });

    it('allows @-mentions in channels listed in groupAllowFrom', async () => {
      const { subscribed } = await loadHandlers({
        groupAllowFrom: 'channel-1, channel-2',
        groupPolicy: 'allowlist',
      });
      const thread = makeGroupThread('channel-1');

      await subscribed(thread, makeMentionMessage());

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('blocks @-mentions in channels outside groupAllowFrom and notifies the sender', async () => {
      const { subscribed } = await loadHandlers({
        groupAllowFrom: 'channel-1',
        groupPolicy: 'allowlist',
      });
      const thread = makeGroupThread('channel-9');

      await subscribed(thread, makeMentionMessage());

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("isn't enabled in this channel");
    });

    it('allows Discord @-mentions when the operator allowlisted ONLY the auto-thread ID', async () => {
      // Operator wants to allow exactly one specific thread (e.g. they
      // copied the thread ID from Discord directly). The router uses
      // `extractChatId` (= the most-specific raw ID, here the thread) as
      // the primary candidate, so an allowlist holding just the thread ID
      // matches.
      const { mention } = await loadHandlers({
        groupAllowFrom: 'auto-thread-id',
        groupPolicy: 'allowlist',
      });
      const thread = {
        channelId: 'auto-thread-id',
        id: 'discord:guild-1:parent-channel:auto-thread-id',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('allows Discord @-mentions when the operator allowlisted the PARENT channel', async () => {
      // Real-world bug: operator pastes the parent channel ID
      // (`parent-channel`) into groupAllowFrom; Discord auto-creates a
      // reply thread for the @-mention so `thread.channelId` is the
      // ephemeral thread ID, not the parent. The router asks the platform
      // client for extra allowlist candidates and accepts the message
      // because the parent matches.
      const { mention } = await loadHandlers({
        groupAllowFrom: 'parent-channel',
        groupPolicy: 'allowlist',
      });
      const thread = {
        channelId: 'auto-thread-id',
        id: 'discord:guild-1:parent-channel:auto-thread-id',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('blocks Discord @-mentions when neither the thread nor parent are allowlisted', async () => {
      const { mention } = await loadHandlers({
        groupAllowFrom: 'some-other-channel',
        groupPolicy: 'allowlist',
      });
      const thread = {
        channelId: 'auto-thread-id',
        id: 'discord:guild-1:parent-channel:auto-thread-id',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("isn't enabled in this channel");
    });

    it('does not affect DMs when group policy is disabled', async () => {
      const { subscribed } = await loadHandlers({ groupPolicy: 'disabled' });
      const thread = {
        channelId: 'dm-channel',
        id: 'telegram:dm',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await subscribed(thread, {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: false,
        text: 'hi in DM',
      });

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('rejection notice visibility (ensureThreadMember)', () => {
    /**
     * on Discord a channel @mention auto-creates a reply
     * thread and rejection notices are posted there — but the rejected
     * sender was never added to the thread, so they got no notification
     * and perceived the bot as silently ignoring them. Every group-scope
     * rejection must pull the sender into the thread before posting.
     */
    async function loadMention(settings: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('discord', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);
      const mention = mockOnNewMention.mock.calls.at(-1);
      if (!mention) throw new Error('mention handler not registered');
      return mention[0] as (thread: any, message: any, ctx?: any) => Promise<void>;
    }

    const groupThread = () => ({
      channelId: 'channel-1',
      id: 'discord:guild-1:channel-1:thread-1',
      isDM: false,
      post: vi.fn().mockResolvedValue(undefined),
    });
    const strangerMessage = {
      author: { isBot: false, userId: 'lin-id', userName: 'lin' },
      isMention: true,
      text: '@bot hello',
    };

    it('pulls an allowFrom-rejected sender into the reply thread before posting the notice', async () => {
      const mention = await loadMention({
        allowFrom: 'alice-id',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = groupThread();

      await mention(thread, strangerMessage);

      expect(mockEnsureThreadMember).toHaveBeenCalledWith(
        'discord:guild-1:channel-1:thread-1',
        'lin-id',
      );
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
      // Membership must be granted before the notice lands so the post
      // generates a notification for the sender.
      expect(mockEnsureThreadMember.mock.invocationCallOrder[0]).toBeLessThan(
        thread.post.mock.invocationCallOrder[0],
      );
    });

    it('pulls a group-policy-rejected sender into the reply thread', async () => {
      const mention = await loadMention({
        dmPolicy: 'open',
        groupAllowFrom: 'some-other-channel',
        groupPolicy: 'allowlist',
      });
      const thread = groupThread();

      await mention(thread, strangerMessage);

      expect(mockEnsureThreadMember).toHaveBeenCalledWith(
        'discord:guild-1:channel-1:thread-1',
        'lin-id',
      );
      expect(thread.post).toHaveBeenCalledTimes(1);
    });

    it('does not touch thread membership for DM rejections', async () => {
      const mention = await loadMention({
        allowFrom: 'alice-id',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = {
        id: 'discord:@me:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, strangerMessage);

      expect(mockEnsureThreadMember).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
    });

    it('still posts the rejection notice when ensureThreadMember fails', async () => {
      mockEnsureThreadMember.mockRejectedValueOnce(new Error('missing permission'));
      const mention = await loadMention({
        allowFrom: 'alice-id',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = groupThread();

      await mention(thread, strangerMessage);

      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
    });
  });

  describe('regression: nested settings.dm.policy is ignored', () => {
    /**
     * Original bug: the form persisted `settings.dmPolicy` (flat) but the
     * router read `settings.dm.policy` (nested), so every saved policy
     * silently fell back to `'open'` and DMs were never blocked. Lock that
     * direction in: the *flat* key is authoritative; the legacy nested
     * shape is dead.
     */
    it('a saved dmPolicy=disabled at the flat key blocks DMs end-to-end', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings: { dmPolicy: 'disabled' } }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const lastCall = mockOnNewMention.mock.calls.at(-1);
      if (!lastCall) throw new Error('onNewMention was not registered');
      const handler = lastCall[0] as (thread: any, message: any, ctx?: any) => Promise<void>;

      const thread = {
        id: 'telegram:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      await handler(thread, {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      });

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("isn't accepting direct messages");
    });

    it('a legacy nested settings.dm.policy=disabled is IGNORED and DMs pass through', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'app-1',
          // Pre-bug-fix shape — nested object the form never actually wrote
          // to. extractDmSettings doesn't read this; policy falls back to
          // 'open', so the DM goes through.
          settings: { dm: { policy: 'disabled' } },
        }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const lastCall = mockOnNewMention.mock.calls.at(-1);
      if (!lastCall) throw new Error('onNewMention was not registered');
      const handler = lastCall[0] as (thread: any, message: any, ctx?: any) => Promise<void>;

      const thread = {
        id: 'telegram:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      await handler(thread, {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      });

      // Nested shape is dead → policy resolved as 'open' → DM goes through.
      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });
  });
});
