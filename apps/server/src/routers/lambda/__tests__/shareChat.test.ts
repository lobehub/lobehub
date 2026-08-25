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

const mockMessageCount = vi.fn();
const mockMessageQuery = vi.fn();
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({ count: mockMessageCount, query: mockMessageQuery })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({ getUserSettings: vi.fn().mockResolvedValue({}) })),
}));

const mockExecAgent = vi.fn();
const AiAgentServiceMock = vi.fn(() => ({ execAgent: mockExecAgent }));
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
    mockMessageCount.mockResolvedValue(0);
    mockMessageQuery.mockResolvedValue([]);
    mockExecAgent.mockResolvedValue({ operationId: 'op-1', success: true });
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
      expect(mockMessageCount).not.toHaveBeenCalled();
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
      mockMessageCount.mockResolvedValue(3);
      const caller = await createCaller();

      await expect(
        caller.execAgent({ prompt: 'hi', shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'ShareTurnLimitExceeded',
      });
      expect(mockMessageCount).toHaveBeenCalledWith({ role: 'user', topicId: 'tpc_visitor' });
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
            visitorUserId: VISITOR,
          },
        }),
      );
    });
  });

  describe('getTopics', () => {
    it("returns only the visitor's own topics via senderId scoping", async () => {
      const caller = await createCaller();
      await caller.getTopics({ shareId: 'share-1' });

      // Topic model is creator-scoped; the query narrows to this visitor.
      expect(TopicModelMock).toHaveBeenCalledWith(expect.anything(), OWNER);
      expect(mockQueryBySender).toHaveBeenCalledWith({
        agentId: share.agentId,
        senderId: VISITOR,
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
      expect(mockMessageQuery).not.toHaveBeenCalled();
    });

    it('serves messages without Work summaries', async () => {
      const caller = await createCaller();
      await caller.getMessages({ shareId: 'share-1', topicId: 'tpc_visitor' });

      expect(mockMessageQuery).toHaveBeenCalledWith(
        { skipWorks: true, topicId: 'tpc_visitor' },
        expect.any(Object),
      );
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
