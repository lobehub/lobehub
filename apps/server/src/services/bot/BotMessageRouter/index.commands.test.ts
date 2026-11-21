import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockDeletePairingRequest,
  mockFindEnabledByPlatform,
  mockGetAgentRuntimeRedisClient,
  mockOnNewMessage,
  mockOnSlashCommand,
  mockPeekPairingRequest,
  mockProviderFindById,
  mockProviderUpdate,
  mockReleasePairingClaim,
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

  describe('/approve persistence failure', () => {
    /**
     * The /approve flow used to consume the pairing code from Redis
     * BEFORE writing the applicant onto allowFrom. If the DB write
     * failed (transient outage, missing provider row), the code was
     * lost yet the owner still saw a success message — leaving the
     * applicant locked out with no recoverable state. These tests pin
     * the corrected ordering: peek-then-persist-then-delete, with a
     * clear failure message and the code preserved for retry on
     * persistence errors.
     */
    async function loadApproveHandler(
      providerOverrides: Record<string, unknown> = {},
    ): Promise<(event: any) => Promise<void>> {
      mockGetAgentRuntimeRedisClient.mockReturnValue({} as any);
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'app-1',
          settings: {
            allowFrom: [{ id: 'owner-id' }],
            dmPolicy: 'pairing',
            userId: 'owner-id',
            ...providerOverrides,
          },
          userId: 'owner-id',
        }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const slashApproveCall = mockOnSlashCommand.mock.calls.find((c) => c[0] === '/approve');
      if (!slashApproveCall) throw new Error('expected /approve to be registered');
      return slashApproveCall[1] as (event: any) => Promise<void>;
    }

    function makeApproveEvent() {
      const channel = {
        id: 'telegram:dm-channel-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      return {
        channel,
        text: 'ABCD2345',
        user: { isBot: false, userId: 'owner-id', userName: 'owner' },
      };
    }

    const PAIRING_ENTRY = {
      applicantUserId: 'lin-id',
      applicantUserName: 'Lin',
      applicationId: 'app-1',
      code: 'ABCD2345',
      createdAt: 1_700_000_000_000,
      platform: 'telegram',
      replyLocale: 'en-US' as const,
      threadId: 'telegram:dm-lin',
    };

    it('reports failure and preserves the code when the DB update throws', async () => {
      mockPeekPairingRequest.mockResolvedValue(PAIRING_ENTRY);
      mockProviderFindById.mockResolvedValue({
        settings: { allowFrom: [{ id: 'owner-id' }] },
      });
      mockProviderUpdate.mockRejectedValue(new Error('connection refused'));

      const slashApprove = await loadApproveHandler();
      const event = makeApproveEvent();
      await slashApprove(event);

      // Owner sees the failure copy, not the success copy. This is the
      // core of the bug: a logged-and-swallowed error must NOT render
      // as a successful approval.
      expect(event.channel.post).toHaveBeenCalledTimes(1);
      const reply = event.channel.post.mock.calls[0][0] as string;
      expect(reply).not.toMatch(/Approved/i);
      expect(reply).toContain("Couldn't save");

      // Code is still in Redis so the owner can rerun /approve, and the
      // peek claim was released so the retry isn't blocked behind our
      // own 60s lock.
      expect(mockDeletePairingRequest).not.toHaveBeenCalled();
      expect(mockReleasePairingClaim).toHaveBeenCalledTimes(1);
    });

    it('reports failure when the provider row is missing', async () => {
      // Edge case: provider deleted between issuing the code and
      // approving it. Without this guard, the old code silently no-op'd
      // and posted "Approved" — now the owner sees the same failure
      // copy and can investigate.
      mockPeekPairingRequest.mockResolvedValue(PAIRING_ENTRY);
      mockProviderFindById.mockResolvedValue(undefined);

      const slashApprove = await loadApproveHandler();
      const event = makeApproveEvent();
      await slashApprove(event);

      expect(event.channel.post).toHaveBeenCalledTimes(1);
      expect(event.channel.post.mock.calls[0][0]).toContain("Couldn't save");
      expect(mockDeletePairingRequest).not.toHaveBeenCalled();
      expect(mockProviderUpdate).not.toHaveBeenCalled();
      expect(mockReleasePairingClaim).toHaveBeenCalledTimes(1);
    });

    it('happy path: persists, then deletes the code, then reports success', async () => {
      mockPeekPairingRequest.mockResolvedValue(PAIRING_ENTRY);
      mockProviderFindById.mockResolvedValue({
        settings: { allowFrom: [{ id: 'owner-id' }] },
      });
      mockProviderUpdate.mockResolvedValue(undefined);

      const slashApprove = await loadApproveHandler();
      const event = makeApproveEvent();
      await slashApprove(event);

      // Persist must precede delete — that's the whole point of the
      // refactor. Use invocationCallOrder to lock the sequence.
      const updateOrder = mockProviderUpdate.mock.invocationCallOrder[0];
      const deleteOrder = mockDeletePairingRequest.mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(deleteOrder);

      expect(mockDeletePairingRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          applicantUserId: 'lin-id',
          applicationId: 'app-1',
          code: 'ABCD2345',
          platform: 'telegram',
        }),
      );

      expect(event.channel.post).toHaveBeenCalledTimes(1);
      expect(event.channel.post.mock.calls[0][0]).toMatch(/Approved Lin/i);
    });

    it('allows /approve when pairing is enabled only for Guest Mode', async () => {
      mockPeekPairingRequest.mockResolvedValue(PAIRING_ENTRY);
      mockProviderFindById.mockResolvedValue({
        settings: { allowFrom: [{ id: 'owner-id' }] },
      });
      mockProviderUpdate.mockResolvedValue(undefined);

      const slashApprove = await loadApproveHandler({
        dmPolicy: 'open',
        guestPolicy: 'pairing',
      });
      const event = makeApproveEvent();
      await slashApprove(event);

      expect(mockProviderUpdate).toHaveBeenCalledTimes(1);
      expect(mockDeletePairingRequest).toHaveBeenCalledTimes(1);
      expect(event.channel.post.mock.calls[0][0]).toMatch(/Approved Lin/i);
    });

    it('skips the DB write when the applicant is already on allowFrom but still cleans up the code', async () => {
      // Read-modify-write idempotency: a second /approve for the same
      // user shouldn't fail just because they're already in. The code
      // gets cleared either way so it can't be reused.
      mockPeekPairingRequest.mockResolvedValue(PAIRING_ENTRY);
      mockProviderFindById.mockResolvedValue({
        settings: { allowFrom: [{ id: 'owner-id' }, { id: 'lin-id', name: 'Lin' }] },
      });

      const slashApprove = await loadApproveHandler();
      const event = makeApproveEvent();
      await slashApprove(event);

      expect(mockProviderUpdate).not.toHaveBeenCalled();
      expect(mockDeletePairingRequest).toHaveBeenCalledTimes(1);
      expect(event.channel.post.mock.calls[0][0]).toMatch(/Approved Lin/i);
    });
  });

  describe('/mode command (per-conversation agent/chat switch)', () => {
    async function loadModeHandlers() {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings: { allowFrom: 'alice-id' } }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const cmdHandlerCall = mockOnNewMessage.mock.calls.find(
        (call) => call[0] instanceof RegExp && call[0].source.includes('mode'),
      );
      const slashModeCall = mockOnSlashCommand.mock.calls.find((c) => c[0] === '/mode');
      if (!cmdHandlerCall || !slashModeCall) throw new Error('/mode handlers not registered');
      return {
        cmdRegexHandler: cmdHandlerCall[1] as (thread: any, message: any) => Promise<void>,
        slashMode: slashModeCall[1] as (event: any) => Promise<void>,
      };
    }

    function makeThread(state: Record<string, unknown> | null = null) {
      return {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
        state: Promise.resolve(state),
      };
    }

    const makeMessage = (text: string) => ({
      author: { isBot: false, userId: 'alice-id', userName: 'alice' },
      isMention: false,
      text,
    });

    it('switches to chat mode via text dispatch and confirms', async () => {
      const { cmdRegexHandler } = await loadModeHandlers();
      const thread = makeThread();

      await cmdRegexHandler(thread, makeMessage('/mode chat'));

      // Merge write (NOT replace) — switching mode must not clobber topicId.
      expect(thread.setState).toHaveBeenCalledWith({ toolMode: 'chat' }, undefined);
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain('Chat Mode');
    });

    it('switches to agent mode via the native slash path', async () => {
      const { slashMode } = await loadModeHandlers();
      const channel = makeThread();
      const event = {
        channel,
        text: 'agent',
        user: { isBot: false, userId: 'alice-id', userName: 'alice' },
      };

      await slashMode(event);

      expect(channel.setState).toHaveBeenCalledWith({ toolMode: 'agent' }, undefined);
      expect(channel.post.mock.calls[0][0]).toContain('Agent Mode');
    });

    it('reports the explicit mode on no-arg /mode without writing state', async () => {
      const { cmdRegexHandler } = await loadModeHandlers();
      const thread = makeThread({ toolMode: 'chat', topicId: 'topic-1' });

      await cmdRegexHandler(thread, makeMessage('/mode'));

      expect(thread.setState).not.toHaveBeenCalled();
      expect(thread.post.mock.calls[0][0]).toContain('Chat Mode');
    });

    it('reports the effective (agent-default) mode when no override is set', async () => {
      const { cmdRegexHandler } = await loadModeHandlers();
      const thread = makeThread(null);

      await cmdRegexHandler(thread, makeMessage('/mode'));

      // No override → the handler resolves the agent's configured default.
      // In this harness the agent-config lookup fails (stub DB), so the
      // best-effort fallback reports the product default: Agent Mode.
      expect(thread.setState).not.toHaveBeenCalled();
      expect(thread.post.mock.calls[0][0]).toContain('Agent Mode');
    });

    it('rejects an unknown mode argument with usage help', async () => {
      const { cmdRegexHandler } = await loadModeHandlers();
      const thread = makeThread();

      await cmdRegexHandler(thread, makeMessage('/mode banana'));

      expect(thread.setState).not.toHaveBeenCalled();
      expect(thread.post.mock.calls[0][0]).toContain('/mode agent');
    });

    it('/new preserves the /mode choice across the state reset', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings: { allowFrom: 'alice-id' } }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      await webhookHandler(
        new Request('https://example.com/webhook', { body: '{}', method: 'POST' }),
      );
      const cmdHandlerCall = mockOnNewMessage.mock.calls.find(
        (call) => call[0] instanceof RegExp && call[0].source.includes('new'),
      );
      const cmdRegexHandler = cmdHandlerCall![1] as (thread: any, message: any) => Promise<void>;
      const thread = makeThread({
        channelContext: { guild: { id: 'g' } },
        toolMode: 'chat',
        topicId: 'topic-1',
      });

      await cmdRegexHandler(thread, makeMessage('/new'));

      // topicId cleared via replace, toolMode carried over, channelContext
      // intentionally dropped (same as before this feature).
      expect(thread.setState).toHaveBeenCalledWith(
        { toolMode: 'chat', topicId: undefined },
        { replace: true },
      );
    });
  });
});
