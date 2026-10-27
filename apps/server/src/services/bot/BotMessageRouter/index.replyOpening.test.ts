import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockFindEnabledByPlatform,
  mockGetBotFeatureAccessState,
  mockGetBotNames,
  mockGetList,
  mockGetPlatform,
  mockHandleMention,
  mockOnNewMention,
  mockOnNewMessage,
  mockOpenThreadForChannelWake,
  resetBotMessageRouterMocks,
} from './testUtils';

/**
 * How a bot opens its reply when the owner leaves the placement to it: an acknowledgement before
 * the run, and the channel or a thread the bot names. The model call itself is faked; what is
 * asserted is what the router does with its answer.
 */

const mocks = vi.hoisted(() => ({
  applyChatPatches: vi.fn(),
  opener: vi.fn(),
  record: vi.fn(),
}));

vi.mock('@/server/services/agentSignal/persistence/recordDecision', () => ({
  recordSignalDecision: mocks.record,
}));
vi.mock('@/server/services/redis', () => ({
  redisService: {
    botWake: {
      countClassifierCall: async () => 1,
      readChannel: async () => undefined,
      readRecentMessages: async () => [],
      recordOwnerSpoke: async () => {},
      rememberMessages: async () => {},
    },
  },
}));
vi.mock('../wake/scheduler', () => ({
  recordWakeRunOutcome: vi.fn(),
  resolveWakeScheduler: () => undefined,
}));
vi.mock('../wake/classify', () => ({
  createWakeClassify: () => vi.fn(),
}));
vi.mock('../wake/dutyJudge', () => ({
  createWakeDutyJudge: () => vi.fn(),
}));
vi.mock('../wake/opener', () => ({ createReplyOpener: () => mocks.opener }));
vi.mock('../wake/identity', () => ({
  createWakeIdentityLoader: () => async () => ({ agentName: 'Nasa', ownerNames: ['Arvin'] }),
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
vi.mock('../deferredMessages', async () => (await import('./testUtils')).deferredMessagesModule());
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
const CHANNEL = 'discord:guild-1:chan-1';
const NEW_THREAD = `${CHANNEL}:thread-9`;

// The shared mock client, plus what a Discord client adds: it knows where a thread can open, and
// takes the router's patch options.
const baseGetPlatform = mockGetPlatform.getMockImplementation()!;
const withDiscordPlacement = () =>
  mockGetPlatform.mockImplementation((platform: string) => {
    const definition = baseGetPlatform(platform);
    const createClient = definition.clientFactory.createClient;

    return {
      ...definition,
      clientFactory: {
        createClient: (...args: unknown[]) => ({
          ...createClient(...args),
          applyChatPatches: mocks.applyChatPatches,
        }),
      },
    };
  });

const boot = async (settings: Record<string, unknown> = {}) => {
  mockFindEnabledByPlatform.mockResolvedValue([
    makeProvider({
      applicationId: 'app-1',
      settings: { dmPolicy: 'open', userId: OWNER, ...settings },
    }),
  ]);
  await new BotMessageRouter().getWebhookHandler(
    'discord',
    'app-1',
  )(new Request('https://example.com/webhook', { body: '{}', method: 'POST' }));
};

const onMention = () => mockOnNewMention.mock.calls.at(-1)![0];
const catchAll = () =>
  mockOnNewMessage.mock.calls.find((c) => c[0] instanceof RegExp && c[0].source === '.')![1];
const deferMentionThread = (): (() => Promise<boolean>) =>
  mocks.applyChatPatches.mock.calls.at(-1)![1].deferMentionThread;

const thread = (id = CHANNEL) => ({
  id,
  isDM: false,
  post: vi.fn().mockResolvedValue(undefined),
  setState: vi.fn().mockResolvedValue(undefined),
  startTyping: vi.fn().mockResolvedValue(undefined),
});
const message = (overrides = {}) => ({
  author: { isBot: false, userId: OWNER, userName: 'arvin' },
  id: 'msg-1',
  isMention: true,
  raw: { id: 'msg-1' },
  text: 'Nasa 帮我查下昨天部署失败的原因',
  ...overrides,
});

const recorded = () => mocks.record.mock.calls.map(([, params]) => params);
const openerVerdicts = () =>
  recorded()
    .flatMap((params) => params.decision.verdicts)
    .filter((verdict: { policyId: string }) => verdict.policyId === 'reply-opener');

describe('BotMessageRouter: the bot opens its own reply', () => {
  beforeEach(() => {
    resetBotMessageRouterMocks();
    withDiscordPlacement();
    mockGetList.mockResolvedValue([OWNER]);
    mockGetBotFeatureAccessState.mockResolvedValue({ allowed: true });
    mockGetBotNames.mockResolvedValue(['Shadow Arvin', 'Nasa']);
    mocks.record.mockResolvedValue({ persisted: false });
  });

  it('keeps @-mentions out of adapter threads, so the bot can choose', async () => {
    await boot();

    await expect(deferMentionThread()()).resolves.toBe(true);
  });

  it('work that runs long: opens a thread it names, acknowledges in it, and tells the agent', async () => {
    mocks.opener.mockResolvedValue({
      ack: '收到，我先翻下昨天的部署日志，再对比下配置。',
      placement: 'thread',
      title: '昨天部署失败排查',
    });
    mockOpenThreadForChannelWake.mockResolvedValue(NEW_THREAD);
    await boot();
    const chatThread = thread();

    await onMention()(chatThread, message());
    await flush();

    expect(mocks.opener).toHaveBeenCalledWith(
      expect.objectContaining({
        botNames: ['Shadow Arvin', 'Nasa'],
        canOpenThread: true,
        message: 'Nasa 帮我查下昨天部署失败的原因',
      }),
      expect.any(AbortSignal),
    );
    expect(mockOpenThreadForChannelWake).toHaveBeenCalledWith(
      CHANNEL,
      { id: 'msg-1' },
      '昨天部署失败排查',
    );
    expect(chatThread.post).toHaveBeenCalledWith('收到，我先翻下昨天的部署日志，再对比下配置。');
    const [dispatchedThread, , opts] = mockHandleMention.mock.calls[0];
    expect(dispatchedThread.id).toBe(NEW_THREAD);
    expect(opts.openingReply).toBe('收到，我先翻下昨天的部署日志，再对比下配置。');
    expect(opts.botContext.platformThreadId).toBe(NEW_THREAD);
    // Recorded where the message arrived, with how the reply was opened.
    expect(recorded()[0].signal.metadata.address.platformThreadId).toBe(CHANNEL);
    expect(openerVerdicts()).toEqual([
      expect.objectContaining({ reason: 'thread+ack', verdict: 'allow' }),
    ]);
  });

  it('a quick question: answers in the channel, with nothing posted before the run', async () => {
    mocks.opener.mockResolvedValue({ placement: 'channel' });
    await boot();
    const chatThread = thread();

    await onMention()(chatThread, message({ text: 'Nasa 在吗' }));
    await flush();

    expect(mockOpenThreadForChannelWake).not.toHaveBeenCalled();
    expect(chatThread.post).not.toHaveBeenCalled();
    const [dispatchedThread, , opts] = mockHandleMention.mock.calls[0];
    expect(dispatchedThread.id).toBe(CHANNEL);
    expect(opts.openingReply).toBeUndefined();
    expect(openerVerdicts()).toEqual([expect.objectContaining({ reason: 'channel' })]);
  });

  it('a model that fails keeps the previous behaviour: a thread, and no acknowledgement', async () => {
    mocks.opener.mockRejectedValue(new Error('provider down'));
    mockOpenThreadForChannelWake.mockResolvedValue(NEW_THREAD);
    await boot();
    const chatThread = thread();

    await onMention()(chatThread, message());
    await flush();

    expect(mockOpenThreadForChannelWake).toHaveBeenCalledWith(CHANNEL, { id: 'msg-1' }, undefined);
    expect(chatThread.post).not.toHaveBeenCalled();
    expect(mockHandleMention.mock.calls[0][0].id).toBe(NEW_THREAD);
    expect(openerVerdicts()).toEqual([
      expect.objectContaining({ reason: 'thread:fallback-error', verdict: 'abstain' }),
    ]);
  });

  it('in a DM it only decides whether to acknowledge', async () => {
    mocks.opener.mockResolvedValue({ ack: '好，我看下。', placement: 'channel' });
    await boot();
    const dm = { ...thread('discord:@me:dm-1'), isDM: true };

    await onMention()(dm, message());
    await flush();

    expect(mocks.opener.mock.calls[0][0].canOpenThread).toBe(false);
    expect(mockOpenThreadForChannelWake).not.toHaveBeenCalled();
    expect(dm.post).toHaveBeenCalledWith('好，我看下。');
    expect(mockHandleMention.mock.calls[0][2].openingReply).toBe('好，我看下。');
  });

  it('a wake nobody asked for answers in the channel, says nothing first, and may stay silent', async () => {
    await boot({ botWake: { enabled: true, mode: 'enforce' } });

    await catchAll()(thread(), message({ isMention: false, text: 'Nasa 回我一句你好' }));
    await flush();

    expect(mocks.opener).not.toHaveBeenCalled();
    expect(mockOpenThreadForChannelWake).not.toHaveBeenCalled();
    const [dispatchedThread, , opts] = mockHandleMention.mock.calls[0];
    expect(dispatchedThread.id).toBe(CHANNEL);
    expect(opts).toMatchObject({ openingReply: undefined, wakeKind: 'followup' });
  });

  describe('when the owner keeps "always open a thread"', () => {
    it('lets the adapter open @-mention threads and never asks the model', async () => {
      await boot({ replyPlacement: 'thread' });

      await expect(deferMentionThread()()).resolves.toBe(false);

      await onMention()(thread(`${CHANNEL}:adapter-thread`), message());
      await flush();
      expect(mocks.opener).not.toHaveBeenCalled();
      expect(openerVerdicts()).toEqual([]);
    });

    it('still opens a thread for a name wake in the channel, as before', async () => {
      mockOpenThreadForChannelWake.mockResolvedValue(NEW_THREAD);
      await boot({ botWake: { enabled: true, mode: 'enforce' }, replyPlacement: 'thread' });

      await catchAll()(thread(), message({ isMention: false, text: 'Nasa 回我一句你好' }));
      await flush();

      expect(mockOpenThreadForChannelWake).toHaveBeenCalledWith(
        CHANNEL,
        { id: 'msg-1' },
        undefined,
      );
      expect(mockHandleMention.mock.calls[0][0].id).toBe(NEW_THREAD);
    });
  });
});
