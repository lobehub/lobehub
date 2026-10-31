import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockFindEnabledByPlatform,
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

describe('BotMessageRouter bot-wake switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBotMessageRouterMocks();
    mockGetList.mockResolvedValue(['alice-id', 'bob-id']);
    mockRecordSignalDecision.mockResolvedValue({ persisted: false });
  });

  describe('switch off: the bot behaves as it did before the pipeline existed', () => {
    it('writes nothing for any inbound path', async () => {
      await boot({
        botWakeDisabled: true,
        dmPolicy: 'open',
        watchKeywords: [{ instruction: '', keyword: 'deploy' }],
      });

      await mentionHandler()(thread(), message({ id: 'm1', isMention: true, text: '@bot hi' }));
      await subscribedHandler()(thread({ id: 'telegram:chat-2' }), message({ id: 'm2' }));
      await catchAllHandler()(thread({ isDM: true }), message({ id: 'm3', text: 'hi' }));
      await flush();

      expect(mockHandleMention).toHaveBeenCalledTimes(2);
      expect(mockRecordSignalDecision).not.toHaveBeenCalled();
    });

    it('answers a watch-keyword wake like any other wake instead of letting it end in silence', async () => {
      await boot({
        botWakeDisabled: true,
        dmPolicy: 'open',
        watchKeywords: [{ instruction: '', keyword: 'deploy' }],
      });

      await subscribedHandler()(
        thread({ id: 'telegram:chat-3' }),
        message({ id: 'm4', text: 'please deploy now' }),
      );
      await flush();

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      expect(mockHandleSubscribedMessage.mock.calls[0][2]).toMatchObject({ wakeKind: 'mention' });
      expect(mockRecordSignalDecision).not.toHaveBeenCalled();
    });

    it('answers a channel keyword wake through the catch-all as before', async () => {
      await boot({
        botWakeDisabled: true,
        dmPolicy: 'open',
        watchKeywords: [{ instruction: '', keyword: 'deploy' }],
      });

      await catchAllHandler()(thread(), message({ id: 'm7', text: 'please deploy now' }));

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(mockHandleMention.mock.calls[0][2]).not.toMatchObject({ wakeKind: 'followup' });
    });
  });

  describe('switch on', () => {
    it('records the decision and lets a watch-keyword wake end in silence, by default', async () => {
      await boot({
        // What the form saved for every bot while the switch was hidden: retired, so it is ignored.
        botWakeEnabled: false,
        dmPolicy: 'open',
        watchKeywords: [{ instruction: '', keyword: 'deploy' }],
      });

      await subscribedHandler()(
        thread({ id: 'telegram:chat-3' }),
        message({ id: 'm5', text: 'please deploy now' }),
      );
      await flush();

      expect(mockHandleSubscribedMessage.mock.calls[0][2]).toMatchObject({ wakeKind: 'followup' });
      expect(mockRecordSignalDecision).toHaveBeenCalledTimes(1);
    });

    it('lets a channel keyword wake through the catch-all end in silence, as in a subscribed thread', async () => {
      await boot({
        botWakeDisabled: false,
        dmPolicy: 'open',
        watchKeywords: [{ instruction: '', keyword: 'deploy' }],
      });

      await catchAllHandler()(thread(), message({ id: 'm8', text: 'please deploy now' }));
      await flush();

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(mockHandleMention.mock.calls[0][2]).toMatchObject({
        named: false,
        wakeKind: 'followup',
      });
    });

    it('always answers a DM through the catch-all, keyword or not', async () => {
      await boot({
        botWakeDisabled: false,
        dmPolicy: 'open',
        watchKeywords: [{ instruction: '', keyword: 'deploy' }],
      });

      await catchAllHandler()(thread({ isDM: true }), message({ id: 'm9', text: 'deploy now' }));

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(mockHandleMention.mock.calls[0][2]).not.toMatchObject({ wakeKind: 'followup' });
      expect(mockHandleMention.mock.calls[0][1].text).toBe('deploy now');
    });

    it('still answers an @mention without any chance of silence', async () => {
      // No switch stored: bot-wake is on by default.
      await boot({ dmPolicy: 'open' });

      await mentionHandler()(thread(), message({ id: 'm6', isMention: true, text: '@bot hi' }));
      await flush();

      expect(mockHandleMention.mock.calls[0][2]).not.toMatchObject({ wakeKind: 'followup' });
    });
  });
});
