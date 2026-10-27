import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockFindEnabledByPlatform,
  mockGetBotFeatureAccessState,
  mockGetList,
  mockHandleMention,
  mockHandleSubscribedMessage,
  mockOnNewMention,
  mockOnNewMessage,
  mockOnSubscribedMessage,
  resetBotMessageRouterMocks,
} from './testUtils';

const mockRecordSignalDecision = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/agentSignal/persistence/recordDecision', () => ({
  recordSignalDecision: mockRecordSignalDecision,
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

/** The recorder is fire-and-forget, so let its detached promise settle before asserting. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const decisions = () =>
  mockRecordSignalDecision.mock.calls.map(([, params]) => ({
    entryPoint: params.signal.metadata?.entryPoint,
    externalId: params.signal.externalId,
    finalReason: params.decision.finalReason,
    outcome: params.decision.outcome,
    pipelineVersion: params.decision.pipelineVersion,
    scopeKey: params.scopeKey,
    toTag: params.decision.toTag,
    verdicts: params.decision.verdicts,
  }));

const boot = async (settings: Record<string, unknown> = { dmPolicy: 'open' }) => {
  mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'app-1', settings })]);
  const router = new BotMessageRouter();
  await router.getWebhookHandler(
    'telegram',
    'app-1',
  )(new Request('https://example.com/webhook', { body: '{}', method: 'POST' }));
};

const mentionHandler = () => mockOnNewMention.mock.calls.at(-1)![0];
const subscribedHandler = () => mockOnSubscribedMessage.mock.calls.at(-1)![0];
const catchAllHandler = () =>
  mockOnNewMessage.mock.calls.find((c) => c[0] instanceof RegExp && c[0].source === '.')![1];

const thread = (overrides = {}) => ({
  id: 'telegram:chat-1',
  isDM: false,
  post: vi.fn().mockResolvedValue(undefined),
  setState: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});
const message = (overrides = {}) => ({
  author: { isBot: false, userId: 'alice-id', userName: 'alice' },
  id: 'msg-1',
  isMention: false,
  text: 'hello there',
  ...overrides,
});

describe('BotMessageRouter bot-wake decision records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBotMessageRouterMocks();
    mockGetList.mockResolvedValue(['alice-id', 'bob-id']);
    mockRecordSignalDecision.mockResolvedValue({ persisted: false });
  });

  it('records a wake for an @mention without changing the dispatch to the agent', async () => {
    await boot();

    await mentionHandler()(thread(), message({ isMention: true, text: '@bot hi' }));
    await flush();

    expect(mockHandleMention).toHaveBeenCalledTimes(1);
    expect(decisions()).toEqual([
      expect.objectContaining({
        entryPoint: 'onNewMention',
        externalId: 'app-1:telegram:chat-1:msg-1',
        finalReason: 'explicit-mention',
        outcome: 'wake',
        pipelineVersion: 'bot-wake@2',
        scopeKey: 'telegram:app-1',
        toTag: 'mention',
        verdicts: [
          expect.objectContaining({
            mode: 'enforce',
            policyId: 'legacy-router',
            verdict: 'allow',
            version: 1,
          }),
        ],
      }),
    ]);
  });

  it('records a skip when the access gate rejects the sender, and still does not wake the agent', async () => {
    await boot({ dmPolicy: 'disabled' });

    await mentionHandler()(
      thread({ id: 'discord:@me:c1', isDM: true }),
      message({ isMention: true }),
    );
    await flush();

    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(decisions()).toEqual([
      expect.objectContaining({
        finalReason: 'access-gate-rejected',
        outcome: 'skip',
        toTag: 'blocked',
        verdicts: [expect.objectContaining({ verdict: 'deny' })],
      }),
    ]);
  });

  it('records a skip for a non-mention in a multi-person subscribed thread', async () => {
    await boot();

    await subscribedHandler()(thread(), message());
    await flush();

    expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
    expect(decisions()).toEqual([
      expect.objectContaining({
        entryPoint: 'onSubscribedMessage',
        finalReason: 'not-addressed',
        outcome: 'skip',
        toTag: 'ignored',
      }),
    ]);
  });

  it('records a wake for a subscribed-thread @mention', async () => {
    await boot();

    await subscribedHandler()(thread(), message({ isMention: true }));
    await flush();

    expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    expect(decisions()).toEqual([
      expect.objectContaining({
        entryPoint: 'onSubscribedMessage',
        finalReason: 'explicit-mention',
        outcome: 'wake',
      }),
    ]);
  });

  it('records a keyword wake and a monitoring-gate skip in the catch-all', async () => {
    await boot({
      dmPolicy: 'open',
      watchKeywords: [{ instruction: '', keyword: 'deploy' }],
    });
    mockGetBotFeatureAccessState.mockResolvedValue({ allowed: true });

    await catchAllHandler()(
      thread({ id: 'telegram:group-9' }),
      message({ text: 'please deploy now' }),
    );
    await flush();

    expect(mockHandleMention).toHaveBeenCalledTimes(1);
    expect(decisions()).toEqual([
      expect.objectContaining({
        entryPoint: 'catchAll',
        finalReason: 'watch-keyword',
        outcome: 'wake',
        toTag: 'keyword',
      }),
    ]);

    mockRecordSignalDecision.mockClear();
    mockHandleMention.mockClear();
    mockGetBotFeatureAccessState.mockResolvedValue({ allowed: false });

    await catchAllHandler()(
      thread({ id: 'telegram:group-9' }),
      message({ id: 'msg-2', text: 'please deploy now' }),
    );
    await flush();

    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(decisions()).toEqual([
      expect.objectContaining({ finalReason: 'monitoring-not-allowed', outcome: 'skip' }),
    ]);
  });

  it('does not record the catch-all’s silent drops of unrelated channel chatter', async () => {
    await boot({ dmPolicy: 'open' });

    await catchAllHandler()(thread({ id: 'telegram:group-9' }), message());
    await flush();

    expect(mockRecordSignalDecision).not.toHaveBeenCalled();
  });

  it('keeps waking the agent when the decision write fails', async () => {
    await boot();
    mockRecordSignalDecision.mockRejectedValue(new Error('db down'));

    await mentionHandler()(thread(), message({ isMention: true }));
    await flush();

    expect(mockHandleMention).toHaveBeenCalledTimes(1);
  });

  it('keeps waking the agent when the recorder throws synchronously', async () => {
    await boot();
    mockRecordSignalDecision.mockImplementation(() => {
      throw new Error('sync boom');
    });

    await mentionHandler()(thread(), message({ isMention: true }));
    await flush();

    expect(mockHandleMention).toHaveBeenCalledTimes(1);
  });
});
