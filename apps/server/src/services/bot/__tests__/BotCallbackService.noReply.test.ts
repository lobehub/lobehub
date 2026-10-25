import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotCallbackBody } from '../BotCallbackService';
import { BotCallbackService } from '../BotCallbackService';

/**
 * Queue mode: the completion / step webhooks land in `BotCallbackService`, so this is where silence
 * (`no_reply`) is recognised and where a follow-up wake's held-back feedback is finally shown.
 * Kept apart from `BotCallbackService.test.ts`, which is at the file-size limit.
 */

const mockCreateMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockEditMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockReplaceReaction = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockTriggerTyping = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRecordNoReplyLabel = vi.hoisted(() => vi.fn());
const mockGenerateTopicTitle = vi.hoisted(() => vi.fn());
const mockBotRouterReplay = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockClearActiveThread = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: {
    findByPlatformAndAppId: vi.fn().mockResolvedValue({
      credentials: '{}',
      settings: { displayToolCalls: true, reactionMode: 'minimal' },
    }),
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return { findById: vi.fn().mockResolvedValue(undefined), update: vi.fn() };
  }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi
      .fn()
      .mockResolvedValue({ decrypt: vi.fn().mockResolvedValue({ plaintext: '{}' }) }),
  },
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
}));
vi.mock('../AgentBridgeService', () => ({
  AgentBridgeService: { clearActiveThread: mockClearActiveThread },
}));
vi.mock('../BotMessageRouter', () => ({
  getBotMessageRouter: () => ({ replayDeferredMessages: mockBotRouterReplay }),
}));
vi.mock('@/server/services/messenger/MessengerRouter', () => ({
  getMessengerRouter: () => ({ replayDeferredMessages: vi.fn() }),
}));
vi.mock('@/server/services/gateway/MessageGatewayClient', () => ({
  getMessageGatewayClient: vi.fn().mockReturnValue({ isEnabled: false }),
}));
vi.mock('@/server/services/systemAgent', () => ({
  SystemAgentService: vi.fn().mockImplementation(function () {
    return { generateTopicTitle: mockGenerateTopicTitle };
  }),
}));
vi.mock('@/server/services/messenger/installations', () => ({
  getInstallationStore: vi.fn(),
  messengerConnectionIdForUser: vi.fn(),
}));
vi.mock('@/server/services/messenger/platforms', () => ({
  messengerPlatformRegistry: { createBinder: vi.fn(), getPlatform: vi.fn() },
}));
vi.mock('../noReplyLabel', () => ({ recordNoReplyLabel: mockRecordNoReplyLabel }));
vi.mock('../platforms', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const client = {
    extractChatId: (id: string) => id,
    getMessenger: () => ({
      createMessage: mockCreateMessage,
      editMessage: mockEditMessage,
      removeReaction: vi.fn(),
      replaceReaction: mockReplaceReaction,
      triggerTyping: mockTriggerTyping,
    }),
  };
  return {
    ...actual,
    platformRegistry: {
      getPlatform: () => ({
        clientFactory: { createClient: () => client },
        credentials: [],
        id: 'discord',
        name: 'discord',
        schema: [],
      }),
    },
  };
});

const body = (overrides: Partial<BotCallbackBody> = {}): BotCallbackBody => ({
  applicationId: 'app-1',
  operationId: 'op-1',
  platformThreadId: 'discord:guild:channel',
  reason: 'done',
  topicId: 'topic-1',
  type: 'completion',
  userId: 'user-1',
  userMessageId: 'msg-1',
  userPrompt: 'we have a bug',
  ...overrides,
});

describe('BotCallbackService no_reply (queue mode)', () => {
  let service: BotCallbackService;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BotCallbackService({} as any);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => consoleError.mockRestore());

  describe('completion', () => {
    it('followup NO_REPLY: posts nothing, is not logged as a fault, and labels the wake', async () => {
      await service.handleCallback(
        body({ lastAssistantContent: 'NO_REPLY:duplicate', wakeKind: 'followup' }),
      );

      expect(mockCreateMessage).not.toHaveBeenCalled();
      expect(mockEditMessage).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(mockRecordNoReplyLabel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          applicationId: 'app-1',
          noReply: { reason: 'duplicate' },
          operationId: 'op-1',
          platform: 'discord',
          platformThreadId: 'discord:guild:channel',
          userId: 'user-1',
          userMessageId: 'msg-1',
        }),
      );
    });

    it('followup NO_REPLY does not throw under strictDelivery', async () => {
      await expect(
        service.handleCallback(body({ lastAssistantContent: 'NO_REPLY', wakeKind: 'followup' }), {
          strictDelivery: true,
        }),
      ).resolves.toBeUndefined();
      expect(mockRecordNoReplyLabel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ noReply: { reason: 'unspecified' } }),
      );
    });

    it('followup empty completion is silence (empty_completion), not a fault', async () => {
      await service.handleCallback(body({ lastAssistantContent: '', wakeKind: 'followup' }), {
        strictDelivery: true,
      });

      expect(consoleError).not.toHaveBeenCalled();
      expect(mockRecordNoReplyLabel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ noReply: { reason: 'empty_completion' } }),
      );
    });

    it('still cleans up after silence: thread released, deferred follow-ups replayed, no title', async () => {
      await service.handleCallback(
        body({ lastAssistantContent: 'NO_REPLY:off_topic', wakeKind: 'followup' }),
      );

      expect(mockClearActiveThread).toHaveBeenCalledWith('discord:guild:channel');
      expect(mockBotRouterReplay).toHaveBeenCalledWith('discord', 'app-1', 'discord:guild:channel');
      expect(mockGenerateTopicTitle).not.toHaveBeenCalled();
    });

    it('followup with a real answer is delivered normally and not labelled', async () => {
      await service.handleCallback(
        body({ lastAssistantContent: 'here is the fix', wakeKind: 'followup' }),
      );

      expect(mockCreateMessage).toHaveBeenCalledTimes(1);
      expect(mockRecordNoReplyLabel).not.toHaveBeenCalled();
    });

    it('followup error is still delivered', async () => {
      await service.handleCallback(
        body({
          errorMessage: 'boom',
          errorType: 'ProviderBizError',
          reason: 'error',
          wakeKind: 'followup',
        }),
      );

      expect(mockCreateMessage).toHaveBeenCalledTimes(1);
      expect(mockRecordNoReplyLabel).not.toHaveBeenCalled();
    });

    it('mention keeps treating an empty completion as a fault', async () => {
      await service.handleCallback(body({ lastAssistantContent: '', wakeKind: 'mention' }));

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('completion had no lastAssistantContent'),
      );
      expect(mockRecordNoReplyLabel).not.toHaveBeenCalled();

      await expect(
        service.handleCallback(body({ lastAssistantContent: '' }), { strictDelivery: true }),
      ).rejects.toThrow('Creator callback completed without deliverable content');
    });

    it('mention delivers NO_REPLY as ordinary text', async () => {
      await service.handleCallback(body({ lastAssistantContent: 'NO_REPLY', wakeKind: 'mention' }));

      expect(mockCreateMessage).toHaveBeenCalledTimes(1);
      expect(mockRecordNoReplyLabel).not.toHaveBeenCalled();
    });
  });

  describe('step', () => {
    const step = (overrides: Partial<BotCallbackBody> = {}) =>
      body({
        progressMessageId: undefined,
        shouldContinue: true,
        stepType: 'call_tool',
        toolsCalling: [{}],
        type: 'step',
        ...overrides,
      });

    it('followup: first continuing step shows the thinking reaction and typing', async () => {
      await service.handleCallback(step({ wakeKind: 'followup' }));

      expect(mockReplaceReaction).toHaveBeenCalledWith('msg-1', null, '🤔');
      expect(mockTriggerTyping).toHaveBeenCalled();
      // The placeholder is never posted from a callback (it could not be removed on silence).
      expect(mockCreateMessage).not.toHaveBeenCalled();
    });

    it('followup: a step that ends the run shows nothing', async () => {
      await service.handleCallback(step({ shouldContinue: false, wakeKind: 'followup' }));

      expect(mockReplaceReaction).not.toHaveBeenCalledWith('msg-1', null, '🤔');
      expect(mockTriggerTyping).not.toHaveBeenCalled();
    });

    it('mention: step callbacks do not add the held-back feedback', async () => {
      await service.handleCallback(step({ wakeKind: 'mention' }));

      expect(mockReplaceReaction).not.toHaveBeenCalledWith('msg-1', null, '🤔');
    });
  });
});
