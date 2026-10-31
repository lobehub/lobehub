import { Chat } from 'chat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockAppendToList,
  mockDispatchToHandlers,
  mockFindEnabledByPlatform,
  mockGetBotFeatureAccessState,
  mockGetList,
  mockGetPlatform,
  mockHandleSubscribedMessage,
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

  describe('onSubscribedMessage policy', () => {
    // introduced single-human thread relaxation: a non-mention
    // post in a thread with ≤1 known humans now reaches the agent. Most of
    // the existing policy tests are about the multi-human gate (keyword
    // wake, command pass-through, allowlist rejection), so seed two
    // participants by default to keep their semantics. Single-human tests
    // override this explicitly.
    beforeEach(() => {
      mockGetList.mockResolvedValue(['alice-id', 'bob-id']);
    });

    /**
     * Boot the router so its handler registration runs, then return the
     * `onSubscribedMessage` handler that was registered with the Chat SDK
     * so tests can invoke it directly with synthetic thread/message objects.
     */
    async function loadSubscribedHandler(settings?: Record<string, unknown>) {
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

      const lastCall = mockOnSubscribedMessage.mock.calls.at(-1);
      if (!lastCall) throw new Error('onSubscribedMessage was not registered');
      return lastCall[0] as (thread: any, message: any, ctx?: any) => Promise<void>;
    }

    function makeThread(overrides: Partial<{ id: string; isDM: boolean }> = {}) {
      return {
        id: 'telegram:chat-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    function makeMessage(
      overrides: Partial<{ isMention: boolean; text: string; userId: string }> = {},
    ) {
      const { userId = 'alice-id', ...rest } = overrides;
      return {
        author: { isBot: false, userId, userName: 'alice' },
        isMention: false,
        text: 'hello there',
        ...rest,
      };
    }

    it.each([
      ['/new', 'question'],
      ['question', '/new'],
    ])('preserves command and content order for %s then %s', async (first, second) => {
      const events: string[] = [];
      const thread = {
        ...makeThread({ isDM: true }),
        state: Promise.resolve({ topicId: 'old-topic' }),
      };
      thread.setState.mockImplementation(async () => {
        events.push('reset');
      });
      mockHandleSubscribedMessage.mockImplementation(async (_thread, message) => {
        events.push(message.text);
      });
      mockDispatchToHandlers.mockImplementation(async (_adapter, _threadId, message, context) => {
        const handler = mockOnSubscribedMessage.mock.calls.at(-1)![0];
        await handler(thread, message, context);
      });
      try {
        await loadSubscribedHandler();
        const bot = vi.mocked(Chat).mock.results.at(-1)!.value;
        await bot.dispatchToHandlers({}, thread.id, makeMessage({ text: second }), {
          skipped: [makeMessage({ text: first })],
          totalSinceLastHandler: 2,
        });
        expect(events).toEqual([first, second].map((text) => (text === '/new' ? 'reset' : text)));
        expect(thread.setState).toHaveBeenCalledTimes(1);
        expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      } finally {
        mockDispatchToHandlers.mockReset();
      }
    });

    it('should skip non-mention messages in a multi-human group thread', async () => {
      // post-fix the gate keys off thread.isDM || mention ||
      // singleHumanThread. Default beforeEach seeds two known participants,
      // a third sender keeps the thread in multi-human territory.
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: false });
      const message = makeMessage({
        isMention: false,
        text: 'just chatting with bob',
        userId: 'carol-id',
      });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
    });

    it('should respond to non-mention messages while the channel thread is still single-human ()', async () => {
      // Override the default multi-human seed: no prior participants →
      // tracker records alice as participant #1 → gate lets her through
      // without an explicit @mention.
      mockGetList.mockResolvedValue([]);
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: false });
      const message = makeMessage({ isMention: false, text: 'follow up' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('should skip without announcing mention-only mode when a second human joins', async () => {
      // Alice is already tracked; bob's first non-mention post is the
      // multi-human transition. Bot-wake decides whether the bot still speaks
      // up, so "I'll only respond when you @mention me" would be untrue.
      mockGetList.mockResolvedValue(['alice-id']);
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: false });
      const message = makeMessage({
        isMention: false,
        text: 'hello',
        userId: 'bob-id',
      });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('should respond to @-mentions in group threads', async () => {
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: false });
      const message = makeMessage({ isMention: true, text: '@bot what about this' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('should respond to every message in DM threads (no mention required)', async () => {
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: true });
      const message = makeMessage({ isMention: false, text: 'hi' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    describe('platform-reported membership (isSoloBotConversation)', () => {
      const defaultGetPlatform = mockGetPlatform.getMockImplementation()!;
      afterEach(() => {
        mockGetPlatform.mockImplementation(defaultGetPlatform);
      });

      /** Same client as the default factory, plus a membership lookup. */
      function withMembershipLookup(isSoloBotConversation: ReturnType<typeof vi.fn>) {
        // Persistent, not `Once`: the router resolves the platform more than
        // once between registration and the first handled message.
        mockGetPlatform.mockImplementation(function (platform: string) {
          const def = defaultGetPlatform(platform);
          if (!def) return def;
          const client = def.clientFactory.createClient();
          return {
            ...def,
            clientFactory: {
              createClient: vi.fn().mockReturnValue({ ...client, isSoloBotConversation }),
            },
          };
        });
      }

      it('does not look up membership for a DM — the answer cannot change', async () => {
        // A lapsed cache would otherwise put a platform round-trip in front of
        // every direct message.
        const isSoloBotConversation = vi.fn().mockResolvedValue(false);
        withMembershipLookup(isSoloBotConversation);
        const handler = await loadSubscribedHandler();

        await handler(makeThread({ isDM: true }), makeMessage({ isMention: false, text: 'hi' }));

        expect(isSoloBotConversation).not.toHaveBeenCalled();
        expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      });

      it('does not look up membership for an @mention either', async () => {
        const isSoloBotConversation = vi.fn().mockResolvedValue(false);
        withMembershipLookup(isSoloBotConversation);
        const handler = await loadSubscribedHandler();

        await handler(makeThread(), makeMessage({ isMention: true, text: '@bot hi' }));

        expect(isSoloBotConversation).not.toHaveBeenCalled();
        expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      });

      it('trusts membership over the speaker count for an unmentioned group message', async () => {
        // Only one human has ever SPOKEN here (the old heuristic would let it
        // through), but the platform says the chat is not 1:1 with the bot.
        mockGetList.mockResolvedValue([]);
        const isSoloBotConversation = vi.fn().mockResolvedValue(false);
        withMembershipLookup(isSoloBotConversation);
        const handler = await loadSubscribedHandler();

        await handler(makeThread(), makeMessage({ isMention: false, text: 'just chatting' }));

        expect(isSoloBotConversation).toHaveBeenCalledWith('telegram:chat-1');
        expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      });

      it('skips a shared thread without posting a notice', async () => {
        // One human + this bot + another bot has only one human speaker, but
        // the platform reports it shared: the message is not for the bot.
        mockGetList.mockResolvedValue([]);
        const isSoloBotConversation = vi.fn().mockResolvedValue(false);
        withMembershipLookup(isSoloBotConversation);
        const handler = await loadSubscribedHandler();
        const thread = makeThread({ id: 'discord:guild-1:channel-1:thread-1' });

        await handler(thread, makeMessage({ isMention: false, text: 'talking to another bot' }));

        expect(isSoloBotConversation).toHaveBeenCalledWith('discord:guild-1:channel-1:thread-1');
        expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
        expect(thread.post).not.toHaveBeenCalled();
      });

      it('routes real Discord membership verdicts and preserves batched participants', async () => {
        const { DiscordClientFactory } = await import('../platforms/discord/client');
        const { clearDiscordChatCompositionMemoryCache } =
          await import('../platforms/discord/chatComposition');
        clearDiscordChatCompositionMemoryCache();
        const client = new DiscordClientFactory().createClient(
          {
            applicationId: 'app-123',
            credentials: { botToken: 'fixture-token', publicKey: 'fixture-key' },
            platform: 'discord',
            settings: {},
          },
          {},
        );
        const human = (id: string) => ({ member: { user: { bot: false, id } } });
        const botMember = (id: string) => ({ member: { user: { bot: true, id } } });
        const requests: unknown[] = [];
        const get = vi.fn(async (path: string, options: { query: URLSearchParams }) => {
          requests.push({ path, query: Object.fromEntries(options.query) });
          if (path.includes('unavailable')) throw new Error('Missing Access');
          return path.includes('shared')
            ? [human('alice-id'), botMember('app-123'), botMember('other-bot')]
            : [human('alice-id'), botMember('app-123')];
        });
        (client as any).discord.rest = { get };
        const membership = vi.fn((id: string) => client.isSoloBotConversation!(id));
        withMembershipLookup(membership);

        const lists = new Map<string, string[]>();
        mockGetList.mockImplementation(async (key: string) => lists.get(key) ?? []);
        mockAppendToList.mockImplementation(async (key: string, id: string) => {
          lists.set(key, [...(lists.get(key) ?? []), id]);
        });
        const handler = await loadSubscribedHandler();
        const observations: Record<string, unknown> = {};
        for (const scenario of ['solo', 'shared', 'unavailable', 'channel']) {
          const id = `discord:guild-1:channel-1${scenario === 'channel' ? '' : `:${scenario}`}`;
          const thread = makeThread({ id });
          mockHandleSubscribedMessage.mockClear();
          await handler(thread, makeMessage({ text: 'ordinary follow-up' }));
          const firstDispatches = mockHandleSubscribedMessage.mock.calls.length;
          const firstPosts = thread.post.mock.calls.length;
          await handler(thread, makeMessage({ text: 'second follow-up' }));
          const repeatedPosts = thread.post.mock.calls.length;
          mockHandleSubscribedMessage.mockClear();
          await handler(thread, makeMessage({ isMention: true, text: '@bot please answer' }));
          observations[scenario] = {
            firstDispatches,
            firstPosts,
            mentionDispatches: mockHandleSubscribedMessage.mock.calls.length,
            repeatedPosts,
          };
          expect(firstDispatches).toBe(scenario === 'solo' ? 1 : 0);
          expect(firstPosts).toBe(0);
          expect(repeatedPosts).toBe(0);
          expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
        }

        const queuedThread = makeThread({ id: 'discord:guild-1:channel-1:queued' });
        const botMessage = {
          author: { isBot: true, userId: 'other-bot', userName: 'other bot' },
          isMention: false,
          text: 'bot reply',
        };
        mockHandleSubscribedMessage.mockClear();
        await handler(queuedThread, botMessage, {
          skipped: [
            makeMessage({ userId: 'bob-id' }),
            botMessage,
            makeMessage({ userId: 'carol-id' }),
          ],
          totalSinceLastHandler: 4,
        });
        const queuedHumans = lists.get(`messenger:thread-humans:${queuedThread.id}`);
        expect(queuedHumans).toEqual(['bob-id', 'other-bot', 'carol-id']);
        expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
        observations.queued = {
          agentDispatches: mockHandleSubscribedMessage.mock.calls.length,
          inputSenders: ['bob-id', 'other-bot', 'carol-id', 'other-bot'],
          persistedHumans: queuedHumans,
        };
        if (process.env.T500_ACCEPTANCE_CAPTURE === '1') {
          console.log(
            'T500_ACCEPTANCE:integrated-routing',
            JSON.stringify({ observations, requests }),
          );
        }
        clearDiscordChatCompositionMemoryCache();
      });
    });

    it('tracks every sender, including other bots, preserved in context.skipped', async () => {
      mockGetList.mockResolvedValue(['alice-id']);
      const handler = await loadSubscribedHandler();
      const thread = makeThread();
      const skipped = [
        makeMessage({ text: 'from bob', userId: 'bob-id' }),
        {
          author: { isBot: true, userId: 'skipped-bot-id', userName: 'skipped bot' },
          isMention: false,
          text: 'from a bot',
        },
        makeMessage({ text: 'from carol', userId: 'carol-id' }),
      ];

      await handler(
        thread,
        makeMessage({ isMention: true, text: '@bot latest', userId: 'alice-id' }),
        { skipped, totalSinceLastHandler: 4 },
      );

      expect(mockAppendToList).toHaveBeenCalledWith(
        'messenger:thread-humans:telegram:chat-1',
        'bob-id',
        expect.any(Object),
      );
      expect(mockAppendToList).toHaveBeenCalledWith(
        'messenger:thread-humans:telegram:chat-1',
        'carol-id',
        expect.any(Object),
      );
      expect(mockAppendToList).toHaveBeenCalledWith(
        'messenger:thread-humans:telegram:chat-1',
        'skipped-bot-id',
        expect.any(Object),
      );
    });

    it('tracks skipped humans before returning for a bot primary message', async () => {
      mockGetList.mockResolvedValue([]);
      const handler = await loadSubscribedHandler();
      const thread = makeThread();
      const skipped = [makeMessage({ text: 'human arrived first', userId: 'alice-id' })];
      const botMessage = {
        author: { isBot: true, userId: 'another-bot', userName: 'other bot' },
        isMention: false,
        text: 'bot primary',
      };

      await handler(thread, botMessage, { skipped, totalSinceLastHandler: 2 });

      expect(mockAppendToList).toHaveBeenCalledWith(
        'messenger:thread-humans:telegram:chat-1',
        'alice-id',
        expect.any(Object),
      );
      expect(mockAppendToList).toHaveBeenCalledWith(
        'messenger:thread-humans:telegram:chat-1',
        'another-bot',
        expect.any(Object),
      );
      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
    });

    it('should respond when a debounced/skipped earlier message contained the mention', async () => {
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: false });
      const skipped = [
        makeMessage({ isMention: true, text: '@bot first question' }),
        makeMessage({ isMention: false, text: 'and one more thing' }),
      ];
      const message = makeMessage({ isMention: false, text: 'last bit' });

      await handler(thread, message, { skipped, totalSinceLastHandler: 3 });

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('should wake on a watch-keyword match in a subscribed group thread ()', async () => {
      const handler = await loadSubscribedHandler({
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }, { keyword: 'outage' }],
      });
      const thread = makeThread({ isDM: false });
      const message = makeMessage({
        isMention: false,
        text: 'hey team, I think we have a bug in checkout',
      });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('marks a watch-keyword wake as a followup, which may end in silence', async () => {
      const handler = await loadSubscribedHandler({
        botWakeEnabled: true,
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }],
      });

      await handler(makeThread(), makeMessage({ text: 'I think we have a bug in checkout' }));

      expect(mockHandleSubscribedMessage.mock.calls[0][2]).toMatchObject({ wakeKind: 'followup' });
    });

    it.each([
      ['an @mention', { isMention: true, text: 'there is a bug, please look' }, false],
      ['a DM', { isMention: false, text: 'hello there' }, true],
    ])('keeps %s as a mention that is always answered', async (_name, overrides, isDM) => {
      const handler = await loadSubscribedHandler({
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }],
      });

      await handler(makeThread({ isDM }), makeMessage(overrides));

      expect(mockHandleSubscribedMessage.mock.calls[0][2]).toMatchObject({ wakeKind: 'mention' });
    });

    it('should drop a keyword wake when messageMonitoring access is not allowed', async () => {
      mockGetBotFeatureAccessState.mockImplementation(async (params: any) =>
        params?.feature === 'messageMonitoring'
          ? { allowed: false, requiredPlan: 'paid' }
          : { allowed: true },
      );
      const handler = await loadSubscribedHandler({
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }],
      });
      const thread = makeThread({ isDM: false });
      const message = makeMessage({
        isMention: false,
        text: 'hey team, I think we have a bug in checkout',
      });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(mockGetBotFeatureAccessState).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'runtime', feature: 'messageMonitoring' }),
      );
    });

    it('should keep handling mentions when messageMonitoring access is not allowed', async () => {
      // The gate only covers passive keyword wakes — explicit @mentions in
      // the same thread must keep flowing for every plan.
      mockGetBotFeatureAccessState.mockImplementation(async (params: any) =>
        params?.feature === 'messageMonitoring'
          ? { allowed: false, requiredPlan: 'paid' }
          : { allowed: true },
      );
      const handler = await loadSubscribedHandler({
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }],
      });
      const thread = makeThread({ isDM: false });
      const message = makeMessage({ isMention: true, text: 'there is a bug, please look' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('should still skip when text contains a keyword as substring only (word boundary)', async () => {
      const handler = await loadSubscribedHandler({
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }],
      });
      const thread = makeThread({ isDM: false });
      // `debug` must NOT trigger `bug` — that would flood the bot in
      // engineering channels where "debug" is everyday vocabulary.
      const message = makeMessage({ isMention: false, text: 'enabling debug logs on prod' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
    });

    it('should wake when a debounced/skipped earlier message contained a watch keyword', async () => {
      const handler = await loadSubscribedHandler({
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }],
      });
      const thread = makeThread({ isDM: false });
      const skipped = [makeMessage({ isMention: false, text: 'found a bug earlier' })];
      const message = makeMessage({ isMention: false, text: 'still investigating' });

      await handler(thread, message, { skipped, totalSinceLastHandler: 2 });

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('should not change behaviour when watchKeywords is empty/missing', async () => {
      // Sanity: existing call sites must keep their pre-semantics.
      const handler = await loadSubscribedHandler({ dmPolicy: 'open' });
      const thread = makeThread({ isDM: false });
      const message = makeMessage({ isMention: false, text: 'there is a bug somewhere' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
    });

    it('should prepend the matched entry instruction to the user message before dispatch', async () => {
      // Operator-authored prompt: when the keyword (and not a mention) is
      // what wakes the bot, the agent should see `instruction\n\nuser text`.
      const handler = await loadSubscribedHandler({
        dmPolicy: 'open',
        watchKeywords: [
          { instruction: 'Scan the thread and reply if it is a real bug.', keyword: 'bug' },
        ],
      });
      const thread = makeThread({ isDM: false });
      const message = makeMessage({
        isMention: false,
        text: 'hey team, I think we have a bug in checkout',
      });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      const [, merged] = mockHandleSubscribedMessage.mock.calls[0];
      expect(merged.text).toBe(
        'Scan the thread and reply if it is a real bug.\n\nhey team, I think we have a bug in checkout',
      );
    });

    it('should merge instructions for every matched entry (dedup, authoring order)', async () => {
      const handler = await loadSubscribedHandler({
        dmPolicy: 'open',
        watchKeywords: [
          { instruction: 'Scan the thread for a bug report.', keyword: 'bug' },
          { instruction: 'Page oncall if downtime is confirmed.', keyword: 'outage' },
          { keyword: 'noise' }, // no instruction → contributes nothing
        ],
      });
      const thread = makeThread({ isDM: false });
      const message = makeMessage({
        isMention: false,
        text: 'we have a bug AND a major outage right now',
      });

      await handler(thread, message);

      const [, merged] = mockHandleSubscribedMessage.mock.calls[0];
      expect(merged.text).toBe(
        'Scan the thread for a bug report.\n\nPage oncall if downtime is confirmed.\n\nwe have a bug AND a major outage right now',
      );
    });

    it('should NOT inject the instruction when the bot is @-mentioned (user-initiated wins)', async () => {
      // Mentions/DMs/commands are explicit user intent — silently stacking an
      // operator prompt on top would surprise the user, so the instruction
      // injection is scoped to the keyword-only wake path.
      const handler = await loadSubscribedHandler({
        dmPolicy: 'open',
        watchKeywords: [{ instruction: 'should not appear', keyword: 'bug' }],
      });
      const thread = makeThread({ isDM: false });
      const message = makeMessage({ isMention: true, text: '@bot we have a bug here' });

      await handler(thread, message);

      const [, merged] = mockHandleSubscribedMessage.mock.calls[0];
      expect(merged.text).toBe('@bot we have a bug here');
    });

    it('should leave the message untouched when matched entries have no instruction', async () => {
      const handler = await loadSubscribedHandler({
        dmPolicy: 'open',
        watchKeywords: [{ keyword: 'bug' }],
      });
      const thread = makeThread({ isDM: false });
      const message = makeMessage({ isMention: false, text: 'tracking down a bug' });

      await handler(thread, message);

      const [, merged] = mockHandleSubscribedMessage.mock.calls[0];
      expect(merged.text).toBe('tracking down a bug');
    });

    it('should ignore messages from other bots', async () => {
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: false });
      const message = {
        author: { isBot: true, userId: 'other-bot-id', userName: 'other-bot' },
        isMention: true,
        text: '@bot hi',
      };

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
    });

    it('should block DM follow-ups when DM is disabled and notify the sender', async () => {
      const handler = await loadSubscribedHandler({ dmPolicy: 'disabled' });
      const thread = makeThread({ isDM: true });
      const message = makeMessage({ isMention: false, text: 'hi' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("isn't accepting direct messages");
    });

    it('should block DM follow-ups for users outside the allowlist and notify the sender', async () => {
      const handler = await loadSubscribedHandler({
        allowFrom: 'bob-id, carol-id',
        dmPolicy: 'allowlist',
      });
      const thread = makeThread({ isDM: true });
      const message = makeMessage({ isMention: false, text: 'hi', userId: 'alice-id' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
    });

    it('should pass DM follow-ups for users on the allowlist', async () => {
      const handler = await loadSubscribedHandler({
        allowFrom: 'alice-id, bob-id',
        dmPolicy: 'allowlist',
      });
      const thread = makeThread({ isDM: true });
      const message = makeMessage({ isMention: false, text: 'hi', userId: 'alice-id' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('should not affect group @-mentions when DM is disabled', async () => {
      const handler = await loadSubscribedHandler({ dmPolicy: 'disabled' });
      const thread = makeThread({ isDM: false });
      const message = makeMessage({ isMention: true, text: '@bot hi' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });
  });
});
