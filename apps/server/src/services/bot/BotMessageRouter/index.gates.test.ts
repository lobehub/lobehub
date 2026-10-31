import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockFindEnabledByPlatform,
  mockHandleMention,
  mockHandleSubscribedMessage,
  mockOnNewMention,
  mockOnNewMessage,
  mockOnSlashCommand,
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

  describe('global allowFrom (user-level identity gate)', () => {
    /**
     * Real-world bug report: DM Policy=Allowlist, allowFrom=[me], Group
     * Policy=Open. A non-allowlisted user @-mentioned the bot in a server
     * channel and the bot still tried to process — because the old
     * implementation only consumed allowFrom under `dmPolicy='allowlist'`
     * and isDM=true. Lock in: a populated allowFrom blocks every inbound
     * surface — DMs and group @mentions alike.
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

    it('blocks a non-allowlisted sender in a group and posts the generic notice in-thread', async () => {
      const { mention } = await loadHandlers({
        allowFrom: 'alice-id',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: true,
        text: '@bot hello',
      };

      await mention(thread, message);

      // Bot must not handle the message...
      expect(mockHandleMention).not.toHaveBeenCalled();
      // ...but must notify the sender in-thread with the generic
      // "interact with this bot" copy. On Discord the post lands in the
      // auto-created reply thread, so it does not pollute the parent
      // channel; on other platforms it lands in the same group/thread
      // the @mention came from, mirroring notifyGroupRejected.
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
      expect(thread.post.mock.calls[0][0]).toContain('interact with this bot');
      // The generic copy intentionally avoids "direct messages" — the
      // sender did not try to DM, they @-mentioned in a group.
      expect(thread.post.mock.calls[0][0]).not.toContain('direct messages');
    });

    it('blocks a non-allowlisted sender in a DM (with notification)', async () => {
      const { mention } = await loadHandlers({
        allowFrom: 'alice-id',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = {
        id: 'telegram:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: true,
        text: '@bot hi',
      };

      await mention(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
    });

    it('lets allowlisted senders through in a group', async () => {
      const { mention } = await loadHandlers({
        allowFrom: 'alice-id',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      };

      await mention(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('blocks subscribed-thread non-allowlisted senders in groups with the generic notice', async () => {
      const { subscribed } = await loadHandlers({
        allowFrom: 'alice-id',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await subscribed(thread, {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: true,
        text: '@bot hi',
      });

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain('interact with this bot');
    });

    it('with empty allowFrom acts as no-op, all senders allowed', async () => {
      const { mention } = await loadHandlers({
        allowFrom: '',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, {
        author: { isBot: false, userId: 'random-user', userName: 'random' },
        isMention: true,
        text: '@bot hi',
      });

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it("treats settings.userId as implicitly allowed when allowFrom doesn't list them (anti-lockout)", async () => {
      // The operator filled in `userId` (the AI-tools field) so AI can
      // push notifications to them, then later set `allowFrom` to scope
      // the bot to a couple of friends — forgetting to add themselves.
      // The router must still let the operator interact.
      const { mention } = await loadHandlers({
        allowFrom: 'friend-1, friend-2',
        dmPolicy: 'open',
        groupPolicy: 'open',
        userId: 'operator-id',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, {
        author: { isBot: false, userId: 'operator-id', userName: 'me' },
        isMention: true,
        text: '@bot hi',
      });

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('does not flip the bot to private mode when only userId is set (allowFrom empty)', async () => {
      // The reverse safety check: a long-standing operator who only ever
      // configured `userId` for AI push must not suddenly find their bot
      // restricted to themselves once allowFrom-as-global-gate ships.
      const { mention } = await loadHandlers({
        dmPolicy: 'open',
        groupPolicy: 'open',
        userId: 'operator-id',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, {
        author: { isBot: false, userId: 'random-user', userName: 'random' },
        isMention: true,
        text: '@bot hi',
      });

      // Random user gets through because allowFrom is empty → no filter.
      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });
  });

  describe('command access gates (P1: /commands must respect allowFrom + DM/group policy)', () => {
    /**
     * Real-world risk: command dispatch (`/new`, `/stop`) historically ran
     * BEFORE the allowFrom / DM-policy / group-policy checks. A blocked
     * sender could still side-effect — `/stop` cancelling an active run,
     * `/new` resetting thread state — even though normal messages were
     * rejected. Lock in: every command-dispatch path applies the same
     * access stack as the message handlers.
     */
    async function loadAllHandlers(settings: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const sub = mockOnSubscribedMessage.mock.calls.at(-1);
      const mention = mockOnNewMention.mock.calls.at(-1);
      // The command-regex onNewMessage is registered LAST (after the DM
      // catch-all `/./`), so pick it by matching the `/(new|stop)` pattern.
      const cmdHandlerCall = mockOnNewMessage.mock.calls.find(
        (call) => call[0] instanceof RegExp && call[0].source.includes('new'),
      );
      const slashNewCall = mockOnSlashCommand.mock.calls.find((c) => c[0] === '/new');
      const slashStopCall = mockOnSlashCommand.mock.calls.find((c) => c[0] === '/stop');
      if (!sub || !mention || !cmdHandlerCall || !slashNewCall || !slashStopCall) {
        throw new Error('handlers not registered');
      }
      return {
        cmdRegexHandler: cmdHandlerCall[1] as (thread: any, message: any) => Promise<void>,
        mention: mention[0] as (thread: any, message: any, ctx?: any) => Promise<void>,
        slashNew: slashNewCall[1] as (event: any) => Promise<void>,
        slashStop: slashStopCall[1] as (event: any) => Promise<void>,
        subscribed: sub[0] as (thread: any, message: any, ctx?: any) => Promise<void>,
      };
    }

    function makeChannel(overrides: Record<string, unknown> = {}) {
      return {
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('blocks a native /stop slash command from a non-allowlisted sender', async () => {
      const { slashStop } = await loadAllHandlers({ allowFrom: 'alice-id' });
      const channel = makeChannel();
      const event = {
        channel,
        text: '',
        user: { isBot: false, userId: 'lin-id', userName: 'lin' },
      };

      await slashStop(event);

      // Rejection notice posted, but the command handler must not have
      // called setState or kicked off an interruptTask.
      expect(channel.post).toHaveBeenCalledTimes(1);
      expect(channel.post.mock.calls[0][0]).toContain("aren't authorized");
      expect(channel.setState).not.toHaveBeenCalled();
    });

    it('blocks a native /new slash command in a disabled-DM channel', async () => {
      const { slashNew } = await loadAllHandlers({
        dmPolicy: 'disabled',
        groupPolicy: 'open',
      });
      const channel = makeChannel({ isDM: true });
      const event = {
        channel,
        text: '',
        user: { isBot: false, userId: 'alice-id', userName: 'alice' },
      };

      await slashNew(event);

      // DM rejection notice (mentions DMs / direct messages), no state reset.
      expect(channel.post).toHaveBeenCalledTimes(1);
      expect(channel.post.mock.calls[0][0]).toMatch(/direct message/i);
      expect(channel.setState).not.toHaveBeenCalled();
    });

    it('blocks a native slash command in a non-allowlisted group channel', async () => {
      const { slashNew } = await loadAllHandlers({
        groupAllowFrom: 'channel-2',
        groupPolicy: 'allowlist',
      });
      const channel = makeChannel({ id: 'telegram:channel-9', isDM: false });
      const event = {
        channel,
        text: '',
        user: { isBot: false, userId: 'alice-id', userName: 'alice' },
      };

      await slashNew(event);

      expect(channel.post).toHaveBeenCalledTimes(1);
      expect(channel.post.mock.calls[0][0]).toContain("isn't enabled in this channel");
      expect(channel.setState).not.toHaveBeenCalled();
    });

    it('blocks a text-based /new (Telegram regex path) from a non-allowlisted sender', async () => {
      const { cmdRegexHandler } = await loadAllHandlers({ allowFrom: 'alice-id' });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: false,
        text: '/new',
      };

      await cmdRegexHandler(thread, message);

      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
      expect(thread.setState).not.toHaveBeenCalled();
    });

    it('blocks /stop typed in onNewMention as a command from a non-allowlisted sender', async () => {
      // Older code dispatched commands BEFORE the allowFrom check; this
      // test catches a regression where /stop in an @-mention slips through.
      const { mention } = await loadAllHandlers({ allowFrom: 'alice-id' });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: true,
        text: '@bot /stop',
      };

      await mention(thread, message);

      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
      expect(thread.setState).not.toHaveBeenCalled();
      expect(mockHandleMention).not.toHaveBeenCalled();
    });

    it('blocks /new typed in onSubscribedMessage from a non-allowlisted sender', async () => {
      const { subscribed } = await loadAllHandlers({ allowFrom: 'alice-id' });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: false,
        text: '/new',
      };

      await subscribed(thread, message);

      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
      expect(thread.setState).not.toHaveBeenCalled();
    });

    it('answers /whoami for a non-allowlisted sender without touching state (bypassGate)', async () => {
      const { cmdRegexHandler } = await loadAllHandlers({ allowFrom: 'alice-id' });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: false,
        text: '/whoami',
      };

      await cmdRegexHandler(thread, message);

      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain('`lin-id`');
      expect(thread.post.mock.calls[0][0]).not.toContain("aren't authorized");
      expect(thread.setState).not.toHaveBeenCalled();
    });

    it('answers /whoami under the pairing DM policy before settings.userId exists (no pairing code)', async () => {
      const { subscribed } = await loadAllHandlers({ dmPolicy: 'pairing' });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
        state: Promise.resolve(null),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: false,
        text: '/whoami',
      };

      await subscribed(thread, message);

      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain('`lin-id`');
      expect(thread.post.mock.calls[0][0]).not.toMatch(/approve/i);
      expect(mockHandleMention).not.toHaveBeenCalled();
    });

    it('marks the caller as operator in /whoami when their ID matches settings.userId', async () => {
      const { cmdRegexHandler } = await loadAllHandlers({ userId: 'lin-id' });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      await cmdRegexHandler(thread, {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: false,
        text: '/whoami',
      });
      expect(thread.post.mock.calls[0][0]).toContain('already set as the bot operator');
    });

    it('still allows /commands from an allowlisted sender (gate does not break the happy path)', async () => {
      const { cmdRegexHandler } = await loadAllHandlers({ allowFrom: 'alice-id' });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: false,
        text: '/new',
      };

      await cmdRegexHandler(thread, message);

      // /new resets the topic (replace=true) and posts a confirmation.
      expect(thread.setState).toHaveBeenCalledWith({ topicId: undefined }, { replace: true });
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).not.toContain("aren't authorized");
    });
  });

  describe('per-message reply locale auto-detect', () => {
    /**
     * Boot the router so its handler registration runs, then return the
     * `onSubscribedMessage` handler — the easiest entry point to drive a
     * locale-detected DM rejection without mocking the bridge call.
     */
    async function loadHandler(settings: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const lastCall = mockOnSubscribedMessage.mock.calls.at(-1);
      if (!lastCall) throw new Error('onSubscribedMessage was not registered');
      return lastCall[0] as (thread: any, message: any, ctx?: any) => Promise<void>;
    }

    it('passes the sender platform locale into the bridge call', async () => {
      const handler = await loadHandler({ dmPolicy: 'open' });
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: false,
        raw: { from: { language_code: 'pt-br' } },
        text: 'olá',
      };

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      // pt-br → pt-BR via the project normalizeLocale
      expect(mockHandleSubscribedMessage.mock.calls[0][2].replyLocale).toBe('pt-BR');
    });

    it('falls back to the platform default locale when the sender locale is missing', async () => {
      const handler = await loadHandler({ dmPolicy: 'open' });
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: false,
        raw: {}, // no language_code → use platform default (en-US for Telegram)
        text: 'hi',
      };

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      expect(mockHandleSubscribedMessage.mock.calls[0][2].replyLocale).toBe('en-US');
    });

    it('uses the sender locale for the DM rejection notice copy', async () => {
      const handler = await loadHandler({ dmPolicy: 'disabled' });
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: false,
        // Chinese-speaking user on Telegram (default en-US) — copy should
        // follow the sender, not the platform default.
        raw: { from: { language_code: 'zh-cn' } },
        text: '你好',
      };

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain('该机器人不接受私信');
    });
  });
});
