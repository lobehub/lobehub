// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MessageModelModule from '@/database/models/message';
import { createContextInner } from '@/libs/trpc/lambda/context';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

const mockAccessCheck = vi.fn();
vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: { findByShareIdWithAccessCheck: (...args: any[]) => mockAccessCheck(...args) },
}));

const mockGetAgentShareBudgetRemaining = vi.fn();
vi.mock('@/business/server/agent-share/agentShareBudgetGate', () => ({
  getAgentShareBudgetRemaining: (...args: any[]) => mockGetAgentShareBudgetRemaining(...args),
}));

const mockFindById = vi.fn();
const mockCountBySender = vi.fn();
const mockQueryBySender = vi.fn();
const TopicModelMock = vi.fn(() => ({
  countBySender: mockCountBySender,
  findById: mockFindById,
  queryBySender: mockQueryBySender,
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: TopicModelMock,
}));

const mockMessageCountByTopic = vi.fn();
const mockMessageQuery = vi.fn();
const mockMessageQueryForVisitor = vi.fn();
vi.mock('@/database/models/message', async (importOriginal) => {
  // Keep the real `sanitizeVisitorError` (rather than re-stubbing it) so the
  // startup-error regression below exercises the SAME projection shareChat
  // reuses in production — not a test-only stand-in that could silently
  // drift from it.
  const actual = await importOriginal<typeof MessageModelModule>();
  return {
    ...actual,
    MessageModel: vi.fn(() => ({
      countByTopic: mockMessageCountByTopic,
      query: mockMessageQuery,
      queryForVisitor: mockMessageQueryForVisitor,
    })),
  };
});

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({ getUserSettings: vi.fn().mockResolvedValue({}) })),
}));

const mockExecAgent = vi.fn();
const mockInterruptTask = vi.fn();
const AiAgentServiceMock = vi.fn(() => ({
  execAgent: mockExecAgent,
  interruptTask: mockInterruptTask,
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: AiAgentServiceMock,
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({ getFileAccessUrl: vi.fn() })),
}));

const mockSignUserJWT = vi.fn();
vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signUserJWT: (...args: any[]) => mockSignUserJWT(...args),
}));

const { shareChatRouter } = await import('../shareChat');

const VISITOR = 'visitor-1';
const OWNER = 'owner-1';

const share = {
  agentId: 'agt_share',
  ownerId: OWNER,
  shareConfig: {
    allowReadMemory: false,
    enabledToolIds: [],
    filePermissionConfig: { agentFiles: 'none', knowledgeBase: 'none', visitorUpload: false },
    maxTopicsPerVisitor: 2,
    maxTurnsPerTopic: 3,
  },
  shareId: 'share-1',
  visibility: 'public',
};

/**
 * The identity every share procedure must construct `AiAgentService` with: the
 * visitor is the ACTOR, the creator is the RESOURCE OWNER. Asserting the whole
 * principal (rather than just the owner id, as this test used to) is what keeps
 * a future refactor from quietly dropping the visitor half and re-attributing
 * the run to the creator.
 */
const expectedVisitorPrincipal = {
  actorUserId: VISITOR,
  delegation: {
    agentId: share.agentId,
    grants: {
      allowReadMemory: share.shareConfig.allowReadMemory,
      enabledToolIds: share.shareConfig.enabledToolIds,
      filePermissionConfig: share.shareConfig.filePermissionConfig,
    },
    shareId: share.shareId,
  },
  resourceOwnerUserId: OWNER,
};

const visitorTopic = {
  agentId: share.agentId,
  id: 'tpc_visitor',
  metadata: { runningOperation: { operationId: 'op-1' } },
  senderId: VISITOR,
  shareId: share.shareId,
};

const createCaller = async () =>
  shareChatRouter.createCaller(await createContextInner({ userId: VISITOR }));

describe('shareChatRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessCheck.mockResolvedValue(share);
    // Not gated by default (mirrors the OSS stub) — existing cases stay unaffected.
    mockGetAgentShareBudgetRemaining.mockResolvedValue(null);
    mockFindById.mockResolvedValue(visitorTopic);
    mockCountBySender.mockResolvedValue(0);
    mockQueryBySender.mockResolvedValue([]);
    mockMessageCountByTopic.mockResolvedValue(0);
    mockMessageQuery.mockResolvedValue([]);
    mockExecAgent.mockResolvedValue({ operationId: 'op-1', success: true });
    mockInterruptTask.mockResolvedValue({ operationId: 'op-1', success: true });
    mockSignUserJWT.mockResolvedValue('visitor-jwt');
  });

  describe('execAgent', () => {
    it('rejects the run when the agent share budget is exhausted, before any topic/message row is touched', async () => {
      mockGetAgentShareBudgetRemaining.mockResolvedValue(0);
      const caller = await createCaller();

      await expect(caller.execAgent({ prompt: 'hi', shareId: 'share-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'InsufficientBudgetForModel',
      });
      expect(mockGetAgentShareBudgetRemaining).toHaveBeenCalledWith({ agentId: share.agentId });
      expect(mockCountBySender).not.toHaveBeenCalled();
      expect(mockMessageCountByTopic).not.toHaveBeenCalled();
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('does not block the run when the budget gate is not gated (null)', async () => {
      mockGetAgentShareBudgetRemaining.mockResolvedValue(null);
      const caller = await createCaller();

      await expect(caller.execAgent({ prompt: 'hi', shareId: 'share-1' })).resolves.toMatchObject({
        operationId: 'op-1',
      });
      expect(mockExecAgent).toHaveBeenCalled();
    });

    it('rejects a new-topic run once the visitor topic cap is reached', async () => {
      mockCountBySender.mockResolvedValue(2);
      const caller = await createCaller();

      await expect(caller.execAgent({ prompt: 'hi', shareId: 'share-1' })).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'ShareTopicLimitExceeded',
      });
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('rejects an existing-topic run once the turn cap is reached', async () => {
      mockMessageCountByTopic.mockResolvedValue(3);
      const caller = await createCaller();

      await expect(
        caller.execAgent({ prompt: 'hi', shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'ShareTurnLimitExceeded',
      });
      expect(mockMessageCountByTopic).toHaveBeenCalledWith({
        role: 'user',
        topicId: 'tpc_visitor',
      });
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it("fails closed when the topic is not the visitor's own share topic", async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, senderId: 'someone-else' });
      const caller = await createCaller();

      await expect(
        caller.execAgent({ prompt: 'hi', shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('dispatches a creator-scoped run carrying the share gate', async () => {
      const caller = await createCaller();

      await expect(caller.execAgent({ prompt: 'hi', shareId: 'share-1' })).resolves.toMatchObject({
        operationId: 'op-1',
      });

      // Service reads/writes/bills as the CREATOR, while recording the VISITOR
      // as the actor driving the run.
      expect(AiAgentServiceMock).toHaveBeenCalledWith(
        expect.anything(),
        expectedVisitorPrincipal,
        expect.any(Object),
      );
      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          // Agent id comes from the share record, not client input.
          agentId: share.agentId,
          shareGate: {
            agentId: share.agentId,
            shareConfig: share.shareConfig,
            shareId: share.shareId,
            visitorUserId: VISITOR,
          },
        }),
      );
    });

    // Regression test: a
    // direct RPC caller (bypassing any client-side textarea limit) could
    // previously submit an HTTP-infrastructure-limit-sized `prompt`, which
    // `AiAgentService.execAgent` would persist verbatim into the CREATOR's
    // messages before any topic/turn cap even runs (those gate request
    // COUNT, not per-request SIZE). The schema now rejects an oversized
    // prompt before any row is touched.
    it('rejects an oversized prompt before any DB row is touched', async () => {
      const caller = await createCaller();
      const oversizedPrompt = 'a'.repeat(20_001);

      await expect(
        caller.execAgent({ prompt: oversizedPrompt, shareId: 'share-1' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mockAccessCheck).not.toHaveBeenCalled();
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('accepts a prompt right at the size limit', async () => {
      const caller = await createCaller();
      const maxPrompt = 'a'.repeat(20_000);

      await expect(
        caller.execAgent({ prompt: maxPrompt, shareId: 'share-1' }),
      ).resolves.toMatchObject({ operationId: 'op-1' });
    });

    // Regression test: a startup failure BEFORE Gateway
    // streaming begins (e.g. the queue/runtime backend returning a raw
    // diagnostic) must not reach the visitor verbatim — the run executes
    // under the CREATOR's identity, so `error.message` here can carry
    // provider/infra detail. `toVisitorSafeStartupError` must project it
    // through the same `sanitizeVisitorError` classification used elsewhere
    // in this branch, not echo it back raw.
    it('redacts a diagnostic startup failure instead of leaking it to the visitor', async () => {
      const diagnostic = new Error(
        'ECONNREFUSED connecting to internal-runtime-queue.prod.internal:6379 (provider=openai, apiKey=sk-***)',
      );
      mockExecAgent.mockRejectedValueOnce(diagnostic);
      const caller = await createCaller();

      const rejection = caller.execAgent({ prompt: 'hi', shareId: 'share-1' });
      await expect(rejection).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
      await rejection.catch((error: any) => {
        expect(error.message).not.toContain('internal-runtime-queue');
        expect(error.message).not.toContain('openai');
        expect(error.message).not.toContain('sk-');
      });
    });

    // Regression test:
    // `AiAgentService.execAgent` RESOLVES (rather than throws) with
    // `{ success: false, error }` when `createOperation` itself fails to
    // start (see `aiAgent/index.ts`'s `execAgent` catch block) — a case the
    // surrounding try/catch above never sees because nothing was thrown.
    // Without a check on the resolved value, that raw `error` (and the
    // whole "started" shape) would flow straight back to the visitor and
    // the Gateway client would try to open a WebSocket for an operation
    // that never began.
    it('redacts a RESOLVED (not thrown) startup failure and never returns it as a live operation', async () => {
      const diagnostic =
        'QStash publish failed: 503 from internal-queue.prod.internal (token=shhh)';
      mockExecAgent.mockResolvedValueOnce({
        agentId: share.agentId,
        assistantMessageId: 'msg_assistant',
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: diagnostic,
        message: 'Agent operation failed to start',
        operationId: 'op-failed',
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId: 'tpc_visitor',
        userMessageId: 'msg_user',
      });
      const caller = await createCaller();

      const rejection = caller.execAgent({ prompt: 'hi', shareId: 'share-1' });
      await expect(rejection).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
      await rejection.catch((error: any) => {
        expect(error.message).not.toContain('internal-queue');
        expect(error.message).not.toContain('token=shhh');
      });
    });

    it('never sets interactiveStart, so concurrent visitor sends contend on the real runningOperation liveness instead of only the short reservation', async () => {
      // Regression test: `interactiveStart:
      // true` makes `TopicModel.tryReserveTaskCallback` skip its `runningOperation`
      // liveness check entirely (`ignoreRunningOperation`) and contend only on the
      // short-lived `taskCallbackReservation`, which is released right after the
      // FIRST operation is created — long before it finishes running. That let a
      // second concurrent visitor send for the same topic claim the topic-start
      // reservation too, create its own creator-credentialed operation, and
      // overwrite the topic's `runningOperation` marker, orphaning the first
      // operation beyond the reach of `interruptTask` / the revocation sweep. See
      // `topicStartReservation.shareVisitorConcurrency.race.test.ts` for the
      // real-Postgres proof of the underlying reservation mechanics this pins.
      const caller = await createCaller();

      await caller.execAgent({ prompt: 'hi', shareId: 'share-1' });

      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({ interactiveStart: false }),
      );
    });
  });

  describe('interruptTask', () => {
    it('interrupts a running operation that matches the topic ownership and running marker', async () => {
      const caller = await createCaller();

      await expect(
        caller.interruptTask({ operationId: 'op-1', shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).resolves.toMatchObject({ operationId: 'op-1', success: true });

      // Service runs as the CREATOR — the run's operation/thread rows live there.
      expect(AiAgentServiceMock).toHaveBeenCalledWith(expect.anything(), expectedVisitorPrincipal);
      expect(mockInterruptTask).toHaveBeenCalledWith({
        operationId: 'op-1',
        topicId: 'tpc_visitor',
      });
    });

    it("fails closed when the topic is not the visitor's own share topic", async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, senderId: 'someone-else' });
      const caller = await createCaller();

      await expect(
        caller.interruptTask({ operationId: 'op-1', shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockInterruptTask).not.toHaveBeenCalled();
    });

    it('rejects an operationId that does not match the topic’s current running operation', async () => {
      const caller = await createCaller();

      await expect(
        caller.interruptTask({
          operationId: 'op-someone-elses',
          shareId: 'share-1',
          topicId: 'tpc_visitor',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockInterruptTask).not.toHaveBeenCalled();
    });

    it('rejects when the topic has no running operation at all', async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, metadata: {} });
      const caller = await createCaller();

      await expect(
        caller.interruptTask({ operationId: 'op-1', shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockInterruptTask).not.toHaveBeenCalled();
    });

    // Regression test: same startup-failure redaction as
    // `execAgent` — `AiAgentService.interruptTask` also runs creator-scoped
    // and can throw a raw infra/provider diagnostic before any Gateway event
    // exists to sanitize.
    it('redacts a diagnostic interrupt failure instead of leaking it to the visitor', async () => {
      const diagnostic = new Error(
        'pg driver error: relation "operations_internal" does not exist',
      );
      mockInterruptTask.mockRejectedValueOnce(diagnostic);
      const caller = await createCaller();

      const rejection = caller.interruptTask({
        operationId: 'op-1',
        shareId: 'share-1',
        topicId: 'tpc_visitor',
      });
      await expect(rejection).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
      await rejection.catch((error: any) => {
        expect(error.message).not.toContain('operations_internal');
        expect(error.message).not.toContain('pg driver');
      });
    });
  });

  describe('getTopics', () => {
    it("returns only the visitor's own topics via senderId + shareId scoping", async () => {
      const caller = await createCaller();
      await caller.getTopics({ shareId: 'share-1' });

      // Topic model is creator-scoped; the query narrows to this visitor AND
      // this share instance.
      expect(TopicModelMock).toHaveBeenCalledWith(expect.anything(), OWNER);
      expect(mockQueryBySender).toHaveBeenCalledWith({
        agentId: share.agentId,
        senderId: VISITOR,
        shareId: share.shareId,
      });
    });
  });

  describe('getMessages', () => {
    it('rejects a topic on a different agent of the same creator', async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, agentId: 'agt_other' });
      const caller = await createCaller();

      await expect(
        caller.getMessages({ shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockMessageQueryForVisitor).not.toHaveBeenCalled();
    });

    // Regression test: `AgentShareModel.create()` mints a
    // brand-new `agentShares.id` every disable → re-enable cycle. A topic
    // stamped with a PREVIOUS share instance's id must be rejected even
    // though `senderId`/`agentId` still match the returning visitor.
    it('rejects a topic created under a different (disabled-and-replaced) share instance', async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, shareId: 'old-share-1' });
      const caller = await createCaller();

      await expect(
        caller.getMessages({ shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockMessageQueryForVisitor).not.toHaveBeenCalled();
    });

    it('serves messages without Work summaries', async () => {
      const caller = await createCaller();
      await caller.getMessages({ shareId: 'share-1', topicId: 'tpc_visitor' });

      expect(mockMessageQueryForVisitor).toHaveBeenCalledWith(
        { skipWorks: true, topicId: 'tpc_visitor' },
        expect.any(Object),
      );
    });

    it('uses the visitor-redacted read path, never the raw creator-scoped query()', async () => {
      // Regression: getMessages must call `queryForVisitor` (which strips the
      // creator's sender/spend fields), not `query()` — see message.ts
      // `toVisitorMessage` for what that redaction guards against.
      const caller = await createCaller();
      await caller.getMessages({ shareId: 'share-1', topicId: 'tpc_visitor' });

      expect(mockMessageQuery).not.toHaveBeenCalled();
    });
  });

  describe('refreshGatewayToken', () => {
    it('signs the token for the VISITOR, never the creator', async () => {
      const caller = await createCaller();

      await expect(
        caller.refreshGatewayToken({ shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).resolves.toEqual({ token: 'visitor-jwt' });
      expect(mockSignUserJWT).toHaveBeenCalledWith(VISITOR);
    });

    it('rejects when the topic has no running operation', async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, metadata: {} });
      const caller = await createCaller();

      await expect(
        caller.refreshGatewayToken({ shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockSignUserJWT).not.toHaveBeenCalled();
    });
  });

  it('requires authentication', async () => {
    const caller = shareChatRouter.createCaller(await createContextInner());

    await expect(caller.getTopics({ shareId: 'share-1' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
