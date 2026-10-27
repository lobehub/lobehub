import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockFindEnabledByPlatform,
  mockGetBotFeatureAccessState,
  mockGetBotNames,
  mockGetList,
  mockHandleMention,
  mockHandleSubscribedMessage,
  mockOnNewMessage,
  mockOnSubscribedMessage,
  resetBotMessageRouterMocks,
} from './testUtils';

const mocks = vi.hoisted(() => ({
  defer: vi.fn(),
  submit: vi.fn(),
  channel: { current: undefined as Record<string, unknown> | undefined },
  classify: vi.fn(),
  duty: vi.fn(),
  logs: new Map<string, any[]>(),
  record: vi.fn(),
}));

vi.mock('@/server/services/agentSignal/persistence/recordDecision', () => ({
  recordSignalDecision: mocks.record,
}));
vi.mock('@/server/services/redis', () => ({
  redisService: {
    botWake: {
      countClassifierCall: async () => 1,
      readChannel: async () => mocks.channel.current,
      readRecentMessages: async (key: string, limit: number, excludeId?: string) =>
        (mocks.logs.get(key) ?? []).filter((line) => line.id !== excludeId).slice(-limit),
      recordOwnerSpoke: async () => {},
      rememberMessages: async (keys: string[], lines: any[]) => {
        for (const key of keys) mocks.logs.set(key, [...(mocks.logs.get(key) ?? []), ...lines]);
      },
    },
  },
}));
vi.mock('../wake/scheduler', () => ({
  recordWakeRunOutcome: vi.fn(),
  resolveWakeScheduler: (_platform: string, _app: string, settings: any) =>
    settings?.botWake?.scheduler?.mode === 'enforce' ? { submit: mocks.submit } : undefined,
}));
vi.mock('../wake/classify', () => ({
  createWakeClassify: () => mocks.classify,
}));
vi.mock('../wake/dutyJudge', () => ({
  createWakeDutyJudge: () => mocks.duty,
}));
vi.mock('../wake/identity', () => ({
  createWakeIdentityLoader: () => async () => ({
    agentName: 'Arvin Agent',
    agentTitle: 'Release helper',
    ownerNames: ['Arvin Zhang'],
  }),
}));
vi.mock('@/server/featureFlags', async () => (await import('./testUtils')).featureFlagsModule());
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
vi.mock('../deferredMessages', async () => ({
  ...(await import('./testUtils')).deferredMessagesModule(),
  deferBotMessages: mocks.defer,
}));
vi.mock('../mergeMessages', async (importOriginal) =>
  (await import('./testUtils')).mergeMessagesModule(importOriginal),
);
vi.mock('@/server/services/aiAgent', async () => (await import('./testUtils')).aiAgentModule());
vi.mock('../AgentBridgeService', async () =>
  (await import('./testUtils')).agentBridgeServiceModule(),
);
vi.mock('../platforms', async () => (await import('./testUtils')).platformsModule());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const OWNER = 'owner-id';
const BOT_NAME = 'Shadow Arvin';
const CHANNEL = 'discord:guild-1:chan-1';

const boot = async (
  botWake: Record<string, unknown> | undefined,
  extraSettings: Record<string, unknown> = {},
) => {
  mockFindEnabledByPlatform.mockResolvedValue([
    makeProvider({
      applicationId: 'app-1',
      settings: { botWake, dmPolicy: 'open', userId: OWNER, ...extraSettings },
    }),
  ]);
  await new BotMessageRouter().getWebhookHandler(
    'discord',
    'app-1',
  )(new Request('https://example.com/webhook', { body: '{}', method: 'POST' }));
};

const catchAll = () =>
  mockOnNewMessage.mock.calls.find((c) => c[0] instanceof RegExp && c[0].source === '.')![1];
const subscribed = () => mockOnSubscribedMessage.mock.calls.at(-1)![0];

const thread = (id = CHANNEL) => ({
  id,
  isDM: false,
  post: vi.fn().mockResolvedValue(undefined),
  setState: vi.fn().mockResolvedValue(undefined),
});
const message = (overrides = {}) => ({
  author: { isBot: false, userId: OWNER, userName: 'arvin' },
  id: 'msg-1',
  isMention: false,
  text: `${BOT_NAME} 听得到吗`,
  ...overrides,
});

const decisions = () => mocks.record.mock.calls.map(([, params]) => params.decision);

describe('BotMessageRouter: a message that only names the bot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBotMessageRouterMocks();
    mocks.logs.clear();
    mocks.channel.current = undefined;
    mockGetList.mockResolvedValue([OWNER, 'bob-id']);
    mockGetBotFeatureAccessState.mockResolvedValue({ allowed: true });
    mockGetBotNames.mockResolvedValue([BOT_NAME]);
    mocks.record.mockResolvedValue({ persisted: false });
    mocks.defer.mockResolvedValue(true);
    mocks.submit.mockResolvedValue('hold');
    mocks.classify.mockResolvedValue({ addressedToBot: 0.02, kind: 'chitchat', reason: 'x' });
    mocks.duty.mockResolvedValue({ duty: '评估需求', inDuty: 0.1, reason: 'p=0.10' });
  });

  const enforcing = { enabled: true, mode: 'enforce' };

  it('wakes the bot, as a follow-up that may stay silent, instead of intercepting it (the reported case)', async () => {
    // The bot spoke 4m49s ago in its thread; the owner now says its name in the parent channel.
    mocks.channel.current = { botLastSpokeAt: Date.now() - 289_000, silentWakes: 0 };
    await boot(enforcing);

    await catchAll()(thread(), message());
    await flush();

    expect(mockHandleMention).toHaveBeenCalledTimes(1);
    expect(mockHandleMention.mock.calls[0][2]).toMatchObject({ named: true, wakeKind: 'followup' });
    expect(decisions().map((d) => [d.outcome, d.finalReason, d.toTag])).toEqual([
      ['wake', 'named-in-text', 'named'],
    ]);
    expect(mocks.classify).not.toHaveBeenCalled();
  });

  it('steps in for a message within its duties, from anyone, and tells the agent which duty', async () => {
    mocks.duty.mockResolvedValue({ duty: '评估需求', inDuty: 0.9, reason: 'p=0.90' });
    await boot({ ...enforcing, duties: { text: '群里有人描述需求时评估一下' } });

    await catchAll()(
      thread(),
      message({
        author: { isBot: false, userId: 'bob-id', userName: 'bob' },
        text: '要是导出能保留文件夹结构就好了',
      }),
    );
    await flush();

    expect(mockHandleMention).toHaveBeenCalledTimes(1);
    expect(mockHandleMention.mock.calls[0][2]).toMatchObject({
      duty: { matched: '评估需求' },
      wakeKind: 'followup',
    });
    expect(decisions().map((d) => [d.outcome, d.finalReason, d.toTag])).toEqual([
      ['wake', 'in-duty', 'duty'],
    ]);
  });

  it('stays out of an owner remark it could help with when it has no duties, without asking', async () => {
    await boot(enforcing);

    await catchAll()(
      thread(),
      message({ text: '这个 UI 一眼看上去还是太 vibe 了，得想想怎么refine' }),
    );
    await flush();

    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mocks.duty).not.toHaveBeenCalled();
  });

  describe('with the scheduler enforcing', () => {
    const scheduled = { ...enforcing, scheduler: { mode: 'enforce' } };

    it('answers a message that names the bot at once: it is addressed, so it does not wait out the collect window', async () => {
      mocks.channel.current = { botLastSpokeAt: Date.now() - 60_000, silentWakes: 0 };
      await boot(scheduled);

      await catchAll()(thread(), message());
      await flush();

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(mocks.defer).not.toHaveBeenCalled();
      expect(decisions().map((d) => [d.outcome, d.finalReason])).toEqual([
        ['wake', 'named-in-text'],
      ]);
    });

    it('does the same in a subscribed thread', async () => {
      await boot(scheduled);

      await subscribed()(thread(`${CHANNEL}:thread-1`), message());

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      expect(mocks.submit).not.toHaveBeenCalled();
    });

    it('still parks chatter that only arrives inside the follow-up window', async () => {
      mocks.channel.current = { botLastSpokeAt: Date.now() - 60_000, silentWakes: 0 };
      mocks.classify.mockResolvedValue({ addressedToBot: 0.9, kind: 'request', reason: 'x' });
      await boot({ ...scheduled, classifier: { mode: 'enforce', threshold: 0.5 } });

      await catchAll()(thread(), message({ text: '那现在呢?' }));
      await flush();

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(mocks.submit).toHaveBeenCalledTimes(1);
      expect(mocks.defer).toHaveBeenCalledTimes(1);
      expect(decisions().map((d) => [d.outcome, d.finalReason])).toEqual([['defer', 'scheduled']]);
    });
  });

  it('is still intercepted while the rules only shadow: nothing changes until the owner opts in', async () => {
    await boot({ enabled: true, mode: 'shadow' });

    await catchAll()(thread(), message());
    await flush();

    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(decisions().map((d) => [d.outcome, d.finalReason])).toEqual([['skip', 'not-addressed']]);
  });

  it('is not woken by a message that does not say its name', async () => {
    await boot(enforcing);

    await catchAll()(thread(), message({ text: 'anyone seen the logs?' }));
    await flush();

    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(decisions().map((d) => d.outcome)).toEqual(['skip']);
  });

  it('wakes a subscribed thread the same way', async () => {
    await boot(enforcing);

    await subscribed()(thread(`${CHANNEL}:thread-1`), message());
    await flush();

    expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    expect(mockHandleSubscribedMessage.mock.calls[0][2]).toMatchObject({ wakeKind: 'followup' });
  });

  it('never wakes for another bot, even one that names it', async () => {
    await boot(enforcing);

    await catchAll()(
      thread(),
      message({ author: { isBot: true, userId: 'other-bot', userName: 'other' } }),
    );

    expect(mockHandleMention).not.toHaveBeenCalled();
  });

  it('answers quietly: a sender the access gate rejects gets no notice in the channel', async () => {
    await boot(enforcing, { allowFrom: [OWNER] });
    const chatThread = thread();

    await catchAll()(chatThread, message({ author: { isBot: false, userId: 'stranger' } }));
    await flush();

    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(chatThread.post).not.toHaveBeenCalled();
    expect(decisions().map((d) => [d.outcome, d.finalReason])).toEqual([
      ['skip', 'access-gate-rejected'],
    ]);
  });

  it('answers quietly in a subscribed thread too: a sender the access gate rejects gets no notice', async () => {
    await boot(enforcing, { allowFrom: [OWNER] });
    const chatThread = thread(`${CHANNEL}:thread-1`);

    await subscribed()(chatThread, message({ author: { isBot: false, userId: 'stranger' } }));
    await flush();

    expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
    expect(chatThread.post).not.toHaveBeenCalled();
    expect(decisions().map((d) => [d.outcome, d.finalReason])).toEqual([
      ['skip', 'access-gate-rejected'],
    ]);
  });

  it('still tells a rejected sender who @-mentions the bot in a subscribed thread (that was addressed to it)', async () => {
    await boot(enforcing, { allowFrom: [OWNER] });
    const chatThread = thread(`${CHANNEL}:thread-1`);

    await subscribed()(
      chatThread,
      message({ author: { isBot: false, userId: 'stranger' }, isMention: true }),
    );

    expect(chatThread.post).toHaveBeenCalledTimes(1);
  });

  it("decides on everyone's messages and gives the classifier what they said", async () => {
    mocks.channel.current = { botLastSpokeAt: Date.now() - 60_000, silentWakes: 0 };
    mocks.classify
      .mockResolvedValueOnce({ addressedToBot: 0.1, kind: 'chitchat', reason: 'to the team' })
      .mockResolvedValue({ addressedToBot: 0.9, kind: 'request', reason: 'follow-up' });
    await boot({ ...enforcing, classifier: { mode: 'enforce', threshold: 0.5 } });

    // Bob talks first (not the owner), then the owner asks something plain.
    await catchAll()(
      thread(),
      message({
        author: { isBot: false, userId: 'bob-id', userName: 'bob' },
        id: '100000000000000001',
        text: 'is the deploy done?',
      }),
    );
    await catchAll()(thread(), message({ id: '100000000000000002', text: '那现在呢?' }));
    await flush();

    expect(mockHandleMention).toHaveBeenCalledTimes(1);
    const input = mocks.classify.mock.calls.at(-1)![0];
    expect(input.conversation.recent.map((line: any) => [line.authorName, line.text])).toEqual([
      ['bob', 'is the deploy done?'],
    ]);
    expect(input.conversation.botNames).toEqual([BOT_NAME]);
    expect(decisions().map((d) => [d.outcome, d.finalReason])).toEqual([
      ['skip', 'not-addressed'],
      ['wake', 'followup-window'],
    ]);
  });

  it('gives the classifier the agent’s name and title and the owner’s name, with the owner’s lines marked', async () => {
    mocks.channel.current = { botLastSpokeAt: Date.now() - 60_000, silentWakes: 0 };
    mocks.classify.mockResolvedValue({ addressedToBot: 0.9, kind: 'request', reason: 'x' });
    await boot({ ...enforcing, classifier: { mode: 'enforce', threshold: 0.5 } });

    await catchAll()(thread(), message({ id: '100000000000000001', text: 'ship it' }));
    await catchAll()(thread(), message({ id: '100000000000000002', text: '那现在呢?' }));
    await flush();

    const { conversation } = mocks.classify.mock.calls.at(-1)![0];
    expect(conversation.agent).toEqual({ name: 'Arvin Agent', title: 'Release helper' });
    expect(conversation.ownerId).toBe(OWNER);
    expect(conversation.ownerNames).toContain('Arvin Zhang');
    expect(conversation.ownerNames).toContain('arvin');
  });

  it('records every message of a burst, not just the last one', async () => {
    await boot(enforcing);
    const bob = { isBot: false, userId: 'bob-id', userName: 'bob' };

    await catchAll()(thread(), message({ id: 'm3', text: 'and then?' }), {
      skipped: [
        message({ author: bob, id: 'm1', text: 'hello' }),
        message({ id: 'm2', text: 'ok' }),
      ],
    });
    await flush();

    // Bob's parked message is its own decision; the owner's two merge into one judged text.
    expect(mocks.record.mock.calls.map(([, p]) => p.signal.externalId).sort()).toEqual([
      'app-1:discord:guild-1:chan-1:m1',
      'app-1:discord:guild-1:chan-1:m3',
    ]);
  });

  it('keeps nothing and changes nothing for a bot without bot-wake', async () => {
    await boot(undefined);

    await catchAll()(thread(), message());
    await flush();

    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mocks.logs.size).toBe(0);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
