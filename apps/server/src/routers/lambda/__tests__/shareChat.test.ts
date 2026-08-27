// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({
    countByTopic: mockMessageCountByTopic,
    query: mockMessageQuery,
    queryForVisitor: mockMessageQueryForVisitor,
  })),
}));

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

      // Service runs as the CREATOR — the share's owner, never the visitor.
      expect(AiAgentServiceMock).toHaveBeenCalledWith(expect.anything(), OWNER, expect.any(Object));
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

    it('never sets interactiveStart, so concurrent visitor sends contend on the real runningOperation liveness instead of only the short reservation', async () => {
      // Regression for Codex P1 (LOBE-11930, `shareChat.ts:186`): `interactiveStart:
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
      expect(AiAgentServiceMock).toHaveBeenCalledWith(expect.anything(), OWNER);
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
  });

  describe('getTopics', () => {
    it("returns only the visitor's own topics via senderId + shareId scoping", async () => {
      const caller = await createCaller();
      await caller.getTopics({ shareId: 'share-1' });

      // Topic model is creator-scoped; the query narrows to this visitor AND
      // this share instance — see LOBE-11930 codex P2.
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

    // Regression for LOBE-11930 codex P2: `AgentShareModel.create()` mints a
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
