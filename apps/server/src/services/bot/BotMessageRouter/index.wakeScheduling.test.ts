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

const mocks = vi.hoisted(() => ({
  defer: vi.fn(),
  record: vi.fn(),
  submit: vi.fn(),
}));

vi.mock('@/server/services/agentSignal/persistence/recordDecision', () => ({
  recordSignalDecision: mocks.record,
}));
vi.mock('../wake/scheduler', () => ({
  recordWakeRunOutcome: vi.fn(),
  resolveWakeScheduler: (_platform: string, _app: string, settings: any) =>
    settings?.botWake?.scheduler?.mode === 'enforce' ? { submit: mocks.submit } : undefined,
}));
vi.mock('../wake/classify', () => ({
  createWakeClassify: () => vi.fn(),
}));
vi.mock('../wake/dutyJudge', () => ({
  createWakeDutyJudge: () => vi.fn(),
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

const boot = async (settings: Record<string, unknown>) => {
  mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'app-1', settings })]);
  await new BotMessageRouter().getWebhookHandler(
    'telegram',
    'app-1',
  )(new Request('https://example.com/webhook', { body: '{}', method: 'POST' }));
};

const subscribed = () => mockOnSubscribedMessage.mock.calls.at(-1)![0];
const mention = () => mockOnNewMention.mock.calls.at(-1)![0];
const catchAll = () =>
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
  text: 'we have a bug in checkout',
  ...overrides,
});

const keywordSettings = (botWake?: Record<string, unknown>) => ({
  dmPolicy: 'open',
  watchKeywords: [{ keyword: 'bug' }],
  ...(botWake ? { botWake } : {}),
});

const decisions = () => mocks.record.mock.calls.map(([, params]) => params.decision);

describe('BotMessageRouter follow-up scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBotMessageRouterMocks();
    mockGetList.mockResolvedValue(['alice-id', 'bob-id']);
    mockGetBotFeatureAccessState.mockResolvedValue({ allowed: true });
    mocks.record.mockResolvedValue({ persisted: false });
    mocks.defer.mockResolvedValue(true);
    mocks.submit.mockResolvedValue('hold');
  });

  describe('default behaviour is unchanged', () => {
    it('runs a keyword follow-up straight away when bot-wake is not configured', async () => {
      await boot(keywordSettings());

      await subscribed()(thread(), message());

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(mocks.defer).not.toHaveBeenCalled();
    });

    it('runs it straight away with bot-wake enabled and no scheduler', async () => {
      await boot(keywordSettings({ enabled: true }));

      await subscribed()(thread(), message());

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      expect(mocks.defer).not.toHaveBeenCalled();
    });

    it('does not let shadow policies silence a wake they would deny (an operator override)', async () => {
      await boot(
        keywordSettings({
          classifier: { mode: 'shadow' },
          enabled: true,
          mode: 'shadow',
          rules: { denyChannels: ['chat-1'], scope: 'none' },
        }),
      );

      await subscribed()(thread(), message());
      await flush();

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      const verdicts = decisions()[0].verdicts.map((v: any) => [v.policyId, v.mode, v.verdict]);
      expect(verdicts).toContainEqual(['bot-wake:owner-rules', 'shadow', 'deny']);
    });
  });

  describe('with the scheduler enforcing', () => {
    const settings = keywordSettings({ enabled: true, scheduler: { mode: 'enforce' } });

    it('parks a keyword follow-up instead of running it', async () => {
      await boot(settings);

      await subscribed()(thread(), message());
      await flush();

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(mocks.submit).toHaveBeenCalledWith({
        channelKey: 'telegram:app-1:telegram:chat-1',
        messages: [{ id: 'msg-1', threadId: 'telegram:chat-1' }],
      });
      expect(mocks.defer).toHaveBeenCalledWith('app-1', 'telegram:chat-1', [
        expect.objectContaining({ id: 'msg-1' }),
      ]);
      expect(decisions().map((d) => [d.outcome, d.finalReason])).toEqual([['defer', 'scheduled']]);
    });

    it('runs the message when the scheduler releases it (the replay of its own batch)', async () => {
      mocks.submit.mockResolvedValue('release');
      await boot(settings);

      await subscribed()(thread(), message());

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      expect(mocks.defer).not.toHaveBeenCalled();
    });

    it('runs the message when the scheduler cannot be reached', async () => {
      mocks.submit.mockResolvedValue('unavailable');
      await boot(settings);

      await subscribed()(thread(), message());

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('never schedules an @mention, a DM or a plain thread reply: they are answered at once', async () => {
      await boot(settings);

      await subscribed()(thread(), message({ isMention: true, text: 'bug? @bot' }));
      await subscribed()(thread({ isDM: true }), message({ text: 'hi' }));
      await mention()(thread(), message({ isMention: true, text: '@bot hi' }));

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(2);
      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(mocks.submit).not.toHaveBeenCalled();
    });

    it('answers a keyword the owner marked as the bot name at once, as a named wake', async () => {
      await boot({
        ...settings,
        watchKeywords: [
          { keyword: 'bug' },
          { asName: true, instruction: 'Reply as the team helper.', keyword: 'canis' },
        ],
      });

      await subscribed()(thread(), message({ text: 'canis, are you there?' }));
      await catchAll()(
        thread({ id: 'telegram:group-9' }),
        message({ id: 'msg-9', text: 'canis, are you there?' }),
      );
      await flush();

      expect(mocks.submit).not.toHaveBeenCalled();
      expect(mocks.defer).not.toHaveBeenCalled();
      expect(mockHandleSubscribedMessage.mock.calls[0][2]).toMatchObject({
        named: true,
        wakeKind: 'followup',
      });
      expect(mockHandleMention.mock.calls[0][2]).toMatchObject({
        named: true,
        wakeKind: 'followup',
      });
      // The name still carries its instruction, like any keyword.
      expect(mockHandleMention.mock.calls[0][1].text).toBe(
        'Reply as the team helper.\n\ncanis, are you there?',
      );
      expect(decisions().map((d) => [d.outcome, d.finalReason])).toEqual([
        ['wake', 'named-in-text'],
        ['wake', 'named-in-text'],
      ]);
    });

    it('still parks an unflagged keyword next to a keyword name', async () => {
      await boot({
        ...settings,
        watchKeywords: [{ keyword: 'bug' }, { asName: true, keyword: 'canis' }],
      });

      await subscribed()(thread(), message());

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(mocks.defer).toHaveBeenCalledTimes(1);
    });

    it('parks a catch-all keyword wake before a reply thread is opened for it', async () => {
      await boot(settings);

      await catchAll()(thread({ id: 'telegram:group-9' }), message({ id: 'msg-9' }));

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(mocks.defer).toHaveBeenCalledWith('app-1', 'telegram:group-9', [
        expect.objectContaining({ id: 'msg-9' }),
      ]);
    });
  });

  describe('with a policy enforcing', () => {
    it('drops a keyword follow-up an enforcing owner rule denies, and records why', async () => {
      await boot(
        keywordSettings({ enabled: true, mode: 'enforce', rules: { denyChannels: ['chat-1'] } }),
      );

      await subscribed()(thread(), message());
      await flush();

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(decisions().map((d) => [d.outcome, d.finalReason])).toEqual([
        ['skip', 'policy-denied'],
      ]);
    });

    it('still answers an @mention in a channel the enforcing rules deny', async () => {
      await boot(
        keywordSettings({ enabled: true, mode: 'enforce', rules: { denyChannels: ['chat-1'] } }),
      );

      await subscribed()(thread(), message({ isMention: true, text: 'bug? @bot' }));

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('passive channel chatter', () => {
    it('records chatter nobody addressed to a bot-wake bot, as a skip the policies can judge', async () => {
      await boot({ botWake: { enabled: true }, dmPolicy: 'open' });

      await catchAll()(thread({ id: 'telegram:group-9' }), message({ text: 'lunch anyone?' }));
      await flush();

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(decisions().map((d) => [d.outcome, d.finalReason])).toEqual([
        ['skip', 'not-addressed'],
      ]);
      expect(decisions()[0].verdicts.map((v: any) => v.policyId)).toContain(
        'bot-wake:internal-rules',
      );
    });

    it('records nothing when the monitoring feature is not allowed', async () => {
      mockGetBotFeatureAccessState.mockResolvedValue({ allowed: false });
      await boot({ botWake: { enabled: true }, dmPolicy: 'open' });

      await catchAll()(thread({ id: 'telegram:group-9' }), message({ text: 'lunch anyone?' }));
      await flush();

      expect(mocks.record).not.toHaveBeenCalled();
    });
  });
});
