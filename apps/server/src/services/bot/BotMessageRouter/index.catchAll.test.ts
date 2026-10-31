import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockFindEnabledByPlatform,
  mockGetBotFeatureAccessState,
  mockHandleMention,
  mockOnNewMessage,
  mockOpenThreadForChannelWake,
  mockStateSetIfNotExists,
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

  describe('onNewMessage DM catch-all', () => {
    async function loadDmCatchAllHandler(
      settings?: Record<string, unknown>,
      platform = 'telegram',
    ) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'app-1',
          settings: settings ?? { dmPolicy: 'open' },
        }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler(platform, 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      // The catch-all is the onNewMessage registration with the /./ pattern.
      // The first onNewMessage registration is for text-based slash commands
      // with a specific command regex.
      const catchAllCall = mockOnNewMessage.mock.calls.find((call) => {
        const pattern = call[0];
        return pattern instanceof RegExp && pattern.source === '.';
      });
      if (!catchAllCall) return null;
      return catchAllCall[1] as (thread: any, message: any, ctx?: any) => Promise<void>;
    }

    it('should not register the DM catch-all when DM is disabled', async () => {
      // Bot-wake off too: with it on, the catch-all also listens to channel chatter.
      const handler = await loadDmCatchAllHandler({ botWakeDisabled: true, dmPolicy: 'disabled' });
      expect(handler).toBeNull();
    });

    it('should register the DM catch-all when DM is enabled', async () => {
      const handler = await loadDmCatchAllHandler({ dmPolicy: 'open' });
      expect(handler).not.toBeNull();
    });

    it('should ignore non-DM threads in the catch-all', async () => {
      const handler = await loadDmCatchAllHandler();
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:group-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'hello from a group',
      };

      await handler(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
    });

    it('should handle DM messages through the catch-all', async () => {
      const handler = await loadDmCatchAllHandler();
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'hi in a DM',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('posts a one-time WeChat paid-feature notice and continues handling the DM', async () => {
      mockGetBotFeatureAccessState.mockResolvedValue({
        allowed: true,
        notice: { id: 'wechat-pro-required-v1' },
        requiredPlan: 'paid',
        rolloutMode: 'notice',
      });
      const handler = await loadDmCatchAllHandler({ dmPolicy: 'open' }, 'wechat');
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'wechat:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'wechat-user-1', userName: 'alice' },
        text: 'hi in WeChat',
      };

      await handler(thread, message);

      expect(mockStateSetIfNotExists).toHaveBeenCalledWith(
        'bot-feature-notice:wechat-pro-required-v1:wechat-user-1',
        '1',
      );
      expect(thread.post).toHaveBeenCalledWith(
        '提示：由于 WeChat 渠道通信成本过高，LobeHub 微信渠道能力将于近期调整为付费功能。预告期内已有连接可继续使用，但新建或重新连接微信渠道需要升级到个人付费 Plan。',
      );
      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('does not repeat the WeChat paid-feature notice after dedupe hits', async () => {
      mockGetBotFeatureAccessState.mockResolvedValue({
        allowed: true,
        notice: { id: 'wechat-pro-required-v1' },
        requiredPlan: 'paid',
        rolloutMode: 'notice',
      });
      mockStateSetIfNotExists.mockResolvedValue(false);
      const handler = await loadDmCatchAllHandler({ dmPolicy: 'open' }, 'wechat');
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'wechat:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'wechat-user-1', userName: 'alice' },
        text: 'hi again',
      };

      await handler(thread, message);

      expect(thread.post).not.toHaveBeenCalled();
      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('does not post the paid-feature notice to senders rejected by the access gates', async () => {
      mockGetBotFeatureAccessState.mockResolvedValue({
        allowed: true,
        notice: { id: 'wechat-pro-required-v1' },
        requiredPlan: 'paid',
        rolloutMode: 'notice',
      });
      const handler = await loadDmCatchAllHandler(
        { allowFrom: 'bob-id', dmPolicy: 'allowlist' },
        'wechat',
      );
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'wechat:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'wechat-stranger', userName: 'stranger' },
        text: 'hi in WeChat',
      };

      await handler(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
      // Only the rejection is posted — no plan notice leaks to blocked senders.
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).not.toContain('付费');
    });

    it('posts the enforce-mode denial only to senders that pass the access gates', async () => {
      mockGetBotFeatureAccessState.mockResolvedValue({
        allowed: false,
        blockedMessage: '微信渠道现已升级为付费功能。',
        requiredPlan: 'paid',
        rolloutMode: 'enforce',
      });
      const handler = await loadDmCatchAllHandler(
        { allowFrom: 'bob-id', dmPolicy: 'allowlist' },
        'wechat',
      );
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'wechat:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };

      // A stranger blocked by the allowlist gets the regular rejection, not
      // the paid-block copy — plan state must not leak past the gates.
      await handler(thread, {
        author: { isBot: false, userId: 'wechat-stranger', userName: 'stranger' },
        text: 'hi in WeChat',
      });
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).not.toContain('付费');

      // An allowlisted sender passes the gates and then receives the denial.
      thread.post.mockClear();
      await handler(thread, {
        author: { isBot: false, userId: 'bob-id', userName: 'bob' },
        text: 'hi again',
      });
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain('付费');
      expect(mockHandleMention).not.toHaveBeenCalled();
    });

    it('should block DM messages blocked by the allowlist and notify the sender', async () => {
      const handler = await loadDmCatchAllHandler({
        allowFrom: 'bob-id',
        dmPolicy: 'allowlist',
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'hi in a DM',
      };

      await handler(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
    });

    it('lets pairing-mode strangers reach the DM gate (does NOT short-circuit on allowFrom)', async () => {
      // Regression: previously, the global `allowFrom` gate ran first and
      // rejected anyone not on the list — including strangers DMing a
      // pairing bot, who never reached the pairing flow. With pairing,
      // `allowFrom` is the *post-approval* list (managed by `/approve`),
      // so the global gate must skip on DM threads under pairing.
      const handler = await loadDmCatchAllHandler({
        // allowFrom only contains the operator — Lin is a stranger here.
        allowFrom: [{ id: 'owner-id', name: 'me' }],
        dmPolicy: 'pairing',
        userId: 'owner-id',
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'Lin' },
        text: 'Hi',
      };

      await handler(thread, message);

      // No agent dispatch (gate didn't pass through to the agent)
      expect(mockHandleMention).not.toHaveBeenCalled();
      // Post was made — but it must NOT be the allowlist rejection text
      // (which is what the bug rendered). With redis mocked to null in
      // this suite the pairing flow falls back to the "unavailable"
      // copy; the important thing is we left the global-allowFrom branch
      // and entered the pairing branch.
      expect(thread.post).toHaveBeenCalledTimes(1);
      const text = thread.post.mock.calls[0][0] as string;
      expect(text).not.toContain("aren't authorized");
      expect(text).toContain('Pairing');
    });

    it('owner DMing a pairing bot bypasses the gate via operator-bypass', async () => {
      // Even with allowFrom not yet populated with anyone but the owner,
      // the owner themselves must be able to DM the bot to test it /
      // approve other users.
      const handler = await loadDmCatchAllHandler({
        allowFrom: [{ id: 'owner-id' }],
        dmPolicy: 'pairing',
        userId: 'owner-id',
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'owner-id', userName: 'me' },
        text: 'self test',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('owner bypasses the gate from any channel context (slash-command DM/group safety net)', async () => {
      // Discord's native slash-command events sometimes deliver DM
      // invocations with `event.channel.isDM=false`, which would otherwise
      // route the owner's `/approve` through the group gate and reject
      // them when their channel isn't in `groupAllowFrom`. The operator
      // override neutralises this for any inbound from the bot's owner.
      const handler = await loadDmCatchAllHandler({
        allowFrom: [{ id: 'owner-id' }],
        dmPolicy: 'pairing',
        groupAllowFrom: [{ id: 'allowed-channel' }],
        groupPolicy: 'allowlist',
        userId: 'owner-id',
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      // Mis-reported isDM=false on a DM-y thread — channel id is NOT in
      // groupAllowFrom; without owner override the group gate would
      // reject. (The catch-all itself returns early on isDM!==true, so
      // we use isDM=true here; the assertion is that the DM path lets
      // owner through under the strictest combination of policies.)
      const thread = {
        id: 'discord:dm-channel-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'owner-id', userName: 'me' },
        text: 'self test',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('previously-approved users on a pairing bot pass straight through (no re-pairing)', async () => {
      const handler = await loadDmCatchAllHandler({
        allowFrom: [{ id: 'owner-id' }, { id: 'lin-id', name: 'Lin' }],
        dmPolicy: 'pairing',
        userId: 'owner-id',
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'Lin' },
        text: 'Hello again',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      // No pairing notice was posted — Lin is already approved.
      expect(thread.post).not.toHaveBeenCalled();
    });

    // ---- channel-side keyword wake via catch-all ----
    //
    // Discord (and any platform that opts out of subscribing top-level
    // channels via `shouldSubscribe`) never fires `onSubscribedMessage` for
    // a parent channel — so the only way to wake the bot on a keyword in
    // #general is to route the keyword path through the same `/./`
    // catch-all the DM flow uses. These tests cover that secondary path.

    it('registers the catch-all when DM is disabled but watch keywords are configured', async () => {
      const handler = await loadDmCatchAllHandler({
        dmPolicy: 'disabled',
        watchKeywords: [{ keyword: 'bug' }],
      });
      expect(handler).not.toBeNull();
    });

    it('wakes the bot in a non-DM channel when a watch keyword matches', async () => {
      const handler = await loadDmCatchAllHandler({
        dmPolicy: 'open',
        watchKeywords: [
          { instruction: 'Scan the recent thread for a bug report.', keyword: 'bug' },
        ],
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'discord:guild-1:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'looks like a bug in checkout',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      const [, merged] = mockHandleMention.mock.calls[0];
      expect(merged.text).toBe(
        'Scan the recent thread for a bug report.\n\nlooks like a bug in checkout',
      );
    });

    it('drops a channel keyword wake via catch-all when messageMonitoring is not allowed', async () => {
      mockGetBotFeatureAccessState.mockImplementation(async (params: any) =>
        params?.feature === 'messageMonitoring'
          ? { allowed: false, requiredPlan: 'paid' }
          : { allowed: true },
      );
      const handler = await loadDmCatchAllHandler({
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }],
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'discord:guild-1:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'looks like a bug in checkout',
      };

      await handler(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
    });

    it('keeps DM catch-all handling when messageMonitoring is not allowed', async () => {
      mockGetBotFeatureAccessState.mockImplementation(async (params: any) =>
        params?.feature === 'messageMonitoring'
          ? { allowed: false, requiredPlan: 'paid' }
          : { allowed: true },
      );
      const handler = await loadDmCatchAllHandler({
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }],
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'discord:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'hi bot, found a bug',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('still ignores non-DM channel traffic that does NOT match any watch keyword', async () => {
      // Regression: the relaxed early-return must not turn `/./` into a
      // channel-wide hijack — non-mention chatter without a keyword still
      // belongs to `onSubscribedMessage` (subscribed threads) or nowhere.
      const handler = await loadDmCatchAllHandler({
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }],
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'discord:guild-1:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'just chatting about the weather',
      };

      await handler(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
    });

    it('wakes in channel when only a debounced/skipped sibling carried the keyword', async () => {
      const handler = await loadDmCatchAllHandler({
        dmPolicy: 'open',
        watchKeywords: [{ instruction: 'Scan for bug.', keyword: 'bug' }],
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'discord:guild-1:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const skipped = [
        {
          author: { isBot: false, userId: 'alice-id', userName: 'alice' },
          text: 'found a bug earlier',
        },
      ];
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'still investigating',
      };

      await handler(thread, message, { skipped, totalSinceLastHandler: 2 });

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      // The matched keyword sits in `skipped` text; after merging, both
      // skipped + current text are joined and the instruction is prepended.
      const [, merged] = mockHandleMention.mock.calls[0];
      expect(merged.text).toBe('Scan for bug.\n\nfound a bug earlier\nstill investigating');
    });

    it('opens a sub-thread for the reply when the platform implements openThreadForChannelWake', async () => {
      // Discord (and any platform with thread isolation) upgrades the
      // composite threadId so the chat-sdk routes reactions / typing /
      // post to a fresh sub-thread instead of the parent channel.
      mockOpenThreadForChannelWake.mockResolvedValueOnce('discord:guild-1:channel-1:new-thread-1');
      const handler = await loadDmCatchAllHandler(
        {
          dmPolicy: 'open',
          replyPlacement: 'thread',
          watchKeywords: [{ instruction: 'Scan.', keyword: 'bug' }],
        },
        'discord',
      );
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'discord:guild-1:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        raw: { id: 'msg-99' },
        text: 'there is a bug',
      };

      await handler(thread, message);

      expect(mockOpenThreadForChannelWake).toHaveBeenCalledTimes(1);
      expect(mockOpenThreadForChannelWake.mock.calls[0][0]).toBe('discord:guild-1:channel-1');
      expect(mockOpenThreadForChannelWake.mock.calls[0][1]).toEqual({ id: 'msg-99' });
      // The mutation is observable to handleMention through the thread
      // object — chat-sdk's `thread.post` / subscribe / reaction calls
      // all read `thread.id` lazily, so swapping it propagates.
      expect(thread.id).toBe('discord:guild-1:channel-1:new-thread-1');
      const [dispatchedThread] = mockHandleMention.mock.calls[0];
      expect(dispatchedThread.id).toBe('discord:guild-1:channel-1:new-thread-1');
    });

    it('keeps the original threadId on a platform that offers no reply targets', async () => {
      // Threadless platforms (Telegram / WeChat / QQ) implement no
      // `getReplyTargets`; the bot replies inline in the channel/chat.
      const handler = await loadDmCatchAllHandler({
        dmPolicy: 'open',
        watchKeywords: [{ instruction: 'Scan.', keyword: 'bug' }],
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        raw: { id: 'msg-99' },
        text: 'reporting a bug',
      };

      await handler(thread, message);

      expect(mockOpenThreadForChannelWake).not.toHaveBeenCalled();
      expect(thread.id).toBe('telegram:chat-1');
      const [dispatchedThread] = mockHandleMention.mock.calls[0];
      expect(dispatchedThread.id).toBe('telegram:chat-1');
    });

    it('still dispatches when openThreadForChannelWake throws (best-effort contract)', async () => {
      // A platform API failure must not drop the user's message. The
      // router logs the error and posts in the original channel instead.
      mockOpenThreadForChannelWake.mockRejectedValueOnce(new Error('discord 500'));
      const handler = await loadDmCatchAllHandler(
        { dmPolicy: 'open', replyPlacement: 'thread', watchKeywords: [{ keyword: 'bug' }] },
        'discord',
      );
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'discord:guild-1:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        raw: { id: 'msg-99' },
        text: 'reporting a bug',
      };

      await handler(thread, message);

      expect(mockOpenThreadForChannelWake).toHaveBeenCalledTimes(1);
      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      const [dispatchedThread] = mockHandleMention.mock.calls[0];
      expect(dispatchedThread.id).toBe('discord:guild-1:channel-1');
    });

    it('does NOT call openThreadForChannelWake on the DM path', async () => {
      // DMs already deliver replies in the right context; spawning a
      // thread there would either fail (no thread concept in DMs) or
      // create noise. Scoped to the channel-keyword path only.
      const handler = await loadDmCatchAllHandler({
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }],
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        raw: { id: 'msg-99' },
        text: 'bug here',
      };

      await handler(thread, message);

      expect(mockOpenThreadForChannelWake).not.toHaveBeenCalled();
      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('does NOT inject an instruction when the DM path triggers the catch-all', async () => {
      // DMs are explicit user intent — even if a DM message happens to
      // contain a configured keyword, we should not silently prepend an
      // operator prompt on top of what the user actually wrote.
      const handler = await loadDmCatchAllHandler({
        dmPolicy: 'open',
        watchKeywords: [{ instruction: 'should not appear', keyword: 'bug' }],
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'I think there is a bug in the app',
      };

      await handler(thread, message);

      const [, merged] = mockHandleMention.mock.calls[0];
      expect(merged.text).toBe('I think there is a bug in the app');
    });
  });
});
