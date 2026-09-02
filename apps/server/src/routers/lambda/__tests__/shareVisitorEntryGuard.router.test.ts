// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mocks
// ignore the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

const mockTopicFindOwnTopicById = vi.fn();
const mockTopicFindShareVisitorTopicIds = vi.fn();
const mockTopicFindOwnersByIds = vi.fn();
const mockTopicBatchCreate = vi.fn();
const mockTopicBatchMoveToAgent = vi.fn();
const mockTopicCreate = vi.fn();
const mockTopicDelete = vi.fn();
const mockTopicDuplicate = vi.fn();
const mockTopicSettleRunningOperation = vi.fn();
const mockTopicUpdate = vi.fn();
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(() => ({
    batchCreate: mockTopicBatchCreate,
    batchMoveToAgent: mockTopicBatchMoveToAgent,
    create: mockTopicCreate,
    delete: mockTopicDelete,
    duplicate: mockTopicDuplicate,
    findOwnersByIds: mockTopicFindOwnersByIds,
    findOwnTopicById: mockTopicFindOwnTopicById,
    findShareVisitorTopicIds: mockTopicFindShareVisitorTopicIds,
    settleRunningOperation: mockTopicSettleRunningOperation,
    update: mockTopicUpdate,
  })),
}));

const mockMessageFindShareVisitorMessageIds = vi.fn();
const mockMessageDeleteMessagesBySession = vi.fn();
const mockMessageUpdateTTS = vi.fn();
const mockMessageUpdateTranslate = vi.fn();
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({
    deleteMessagesBySession: mockMessageDeleteMessagesBySession,
    findShareVisitorMessageIds: mockMessageFindShareVisitorMessageIds,
    updateTTS: mockMessageUpdateTTS,
    updateTranslate: mockMessageUpdateTranslate,
  })),
}));

const mockServiceAddFilesToMessage = vi.fn();
const mockServiceBatchMutate = vi.fn();
const mockServiceCancelCompression = vi.fn();
const mockServiceCreateCompressionGroup = vi.fn();
const mockServiceCreateMessage = vi.fn();
const mockServiceFinalizeCompression = vi.fn();
const mockServiceUpdateMessage = vi.fn();
const mockServiceUpdateMessageGroupMetadata = vi.fn();
const mockServiceUpdateMessagePlugin = vi.fn();
const mockServiceUpdateToolArguments = vi.fn();
vi.mock('@/server/services/message', () => ({
  MessageService: vi.fn(() => ({
    addFilesToMessage: mockServiceAddFilesToMessage,
    batchMutate: mockServiceBatchMutate,
    cancelCompression: mockServiceCancelCompression,
    createCompressionGroup: mockServiceCreateCompressionGroup,
    createMessage: mockServiceCreateMessage,
    finalizeCompression: mockServiceFinalizeCompression,
    updateMessage: mockServiceUpdateMessage,
    updateMessageGroupMetadata: mockServiceUpdateMessageGroupMetadata,
    updateMessagePlugin: mockServiceUpdateMessagePlugin,
    updateToolArguments: mockServiceUpdateToolArguments,
  })),
}));

const mockFindDeletableFilesByTopicId = vi.fn();
const mockFileDeleteMany = vi.fn();
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    deleteMany: mockFileDeleteMany,
    findDeletableFilesByTopicId: mockFindDeletableFilesByTopicId,
  })),
}));

const mockDeleteFiles = vi.fn();
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({ deleteFiles: mockDeleteFiles })),
}));

// Topic creation canonicalizes agent/session through the DB; the guard under
// test runs after that step, so short-circuit it.
vi.mock('../_helpers/resolveContext', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveContextWithAgentId: vi.fn(async (input: { agentId?: string }) => ({
    agentId: input.agentId,
    sessionId: 'session-1',
  })),
}));

const { topicRouter } = await import('../topic');
const { messageRouter } = await import('../message');

const userId = 'user-creator';
const visitorTopicId = 'topic-visitor';
const visitorMessageId = 'msg-visitor';

const topicCaller = () => topicRouter.createCaller({ userId } as any);
const messageCaller = () => messageRouter.createCaller({ userId } as any);

/**
 * Agent-share visitor conversations are owned by the creator's `userId`, so
 * every creator-facing write RPC must refuse a raw visitor id.
 */
describe('agent-share visitor guards on creator-facing RPCs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing the caller names is a visitor row.
    mockTopicFindShareVisitorTopicIds.mockResolvedValue([]);
    mockMessageFindShareVisitorMessageIds.mockResolvedValue([]);
    mockTopicDelete.mockResolvedValue({ rowCount: 1 });
    mockTopicUpdate.mockResolvedValue([{ id: 'topic-1' }]);
    mockFindDeletableFilesByTopicId.mockResolvedValue(['file-1']);
    mockFileDeleteMany.mockResolvedValue([{ url: 's3://file-1' }]);
    mockTopicFindOwnTopicById.mockResolvedValue({ id: 'topic-1', userId });
    mockTopicFindOwnersByIds.mockResolvedValue([]);
  });

  describe('topic.removeTopic', () => {
    it('does not delete attachments when the id is a visitor topic', async () => {
      // The visitor topic is invisible to `findOwnTopicById`, and
      // `TopicModel.delete` refuses to remove it — so its files must survive.
      mockTopicFindOwnTopicById.mockResolvedValue(undefined);

      await topicCaller().removeTopic({ id: visitorTopicId, removeFiles: true });

      expect(mockFindDeletableFilesByTopicId).not.toHaveBeenCalled();
      expect(mockFileDeleteMany).not.toHaveBeenCalled();
      expect(mockDeleteFiles).not.toHaveBeenCalled();
    });

    it('still deletes attachments of the creator’s own topic', async () => {
      await topicCaller().removeTopic({ id: 'topic-1', removeFiles: true });

      expect(mockFindDeletableFilesByTopicId).toHaveBeenCalledWith('topic-1');
      expect(mockDeleteFiles).toHaveBeenCalledWith(['s3://file-1']);
    });
  });

  describe('topic.updateTopic', () => {
    it('rejects a visitor topic with NOT_FOUND and never updates', async () => {
      mockTopicFindShareVisitorTopicIds.mockResolvedValue([visitorTopicId]);

      await expect(
        topicCaller().updateTopic({ id: visitorTopicId, value: { title: 'hacked' } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockTopicUpdate).not.toHaveBeenCalled();
    });

    it('updates the creator’s own topic', async () => {
      await topicCaller().updateTopic({ id: 'topic-1', value: { title: 'ok' } });

      expect(mockTopicUpdate).toHaveBeenCalled();
    });
  });

  describe('topic.batchMoveTopics', () => {
    it('rejects a visitor topic with NOT_FOUND and never moves', async () => {
      mockTopicFindShareVisitorTopicIds.mockResolvedValue([visitorTopicId]);

      await expect(
        topicCaller().batchMoveTopics({ targetAgentId: 'agent-1', topicIds: [visitorTopicId] }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockTopicBatchMoveToAgent).not.toHaveBeenCalled();
    });
  });

  describe('topic.cloneTopic', () => {
    it('rejects a visitor topic with NOT_FOUND and never duplicates', async () => {
      mockTopicFindShareVisitorTopicIds.mockResolvedValue([visitorTopicId]);

      await expect(topicCaller().cloneTopic({ id: visitorTopicId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      expect(mockTopicDuplicate).not.toHaveBeenCalled();
    });
  });

  describe('topic.settleRunningOperation', () => {
    it('rejects a visitor topic with NOT_FOUND and never settles', async () => {
      mockTopicFindShareVisitorTopicIds.mockResolvedValue([visitorTopicId]);

      await expect(
        topicCaller().settleRunningOperation({ id: visitorTopicId, operationId: 'op-1' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockTopicSettleRunningOperation).not.toHaveBeenCalled();
    });
  });

  describe('message write RPCs', () => {
    beforeEach(() => {
      mockMessageFindShareVisitorMessageIds.mockResolvedValue([visitorMessageId]);
    });

    it('message.update rejects a visitor message with NOT_FOUND', async () => {
      await expect(
        messageCaller().update({ id: visitorMessageId, value: { content: 'hacked' } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockServiceUpdateMessage).not.toHaveBeenCalled();
    });

    it('message.updateMessagePlugin rejects a visitor message with NOT_FOUND', async () => {
      await expect(
        messageCaller().updateMessagePlugin({ id: visitorMessageId, value: { toolCallId: 'x' } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockServiceUpdateMessagePlugin).not.toHaveBeenCalled();
    });

    it('message.updateTTS rejects a visitor message with NOT_FOUND', async () => {
      await expect(
        messageCaller().updateTTS({ id: visitorMessageId, value: { voice: 'alloy' } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockMessageUpdateTTS).not.toHaveBeenCalled();
    });

    it('message.updateTranslate rejects a visitor message with NOT_FOUND', async () => {
      await expect(
        messageCaller().updateTranslate({ id: visitorMessageId, value: { to: 'zh-CN' } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockMessageUpdateTranslate).not.toHaveBeenCalled();
    });

    it('message.batchMutate rejects a batch that targets a visitor message with NOT_FOUND', async () => {
      await expect(
        messageCaller().batchMutate({
          operations: [
            { id: 'msg-1', type: 'updateMessage', value: { content: 'ok' } },
            { id: visitorMessageId, type: 'updateToolMessage', value: { content: 'hacked' } },
          ],
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockServiceBatchMutate).not.toHaveBeenCalled();
    });

    it('message.addFilesToMessage rejects a visitor message with NOT_FOUND', async () => {
      await expect(
        messageCaller().addFilesToMessage({ fileIds: ['file-1'], id: visitorMessageId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockServiceAddFilesToMessage).not.toHaveBeenCalled();
    });

    it('lets the creator update their own message', async () => {
      mockMessageFindShareVisitorMessageIds.mockResolvedValue([]);
      mockServiceUpdateMessage.mockResolvedValue({ messages: [], success: true });

      await messageCaller().update({ id: 'msg-1', value: { content: 'ok' } });

      expect(mockServiceUpdateMessage).toHaveBeenCalled();
    });
  });

  describe('message write RPCs guarded by topicId', () => {
    beforeEach(() => {
      mockTopicFindShareVisitorTopicIds.mockResolvedValue([visitorTopicId]);
    });

    it('message.updateToolArguments rejects a visitor topic with NOT_FOUND', async () => {
      await expect(
        messageCaller().updateToolArguments({
          toolCallId: 'tool-1',
          topicId: visitorTopicId,
          value: 'hacked',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockServiceUpdateToolArguments).not.toHaveBeenCalled();
    });

    it('message.removeMessagesByAssistant rejects a visitor topic with NOT_FOUND', async () => {
      await expect(
        messageCaller().removeMessagesByAssistant({ topicId: visitorTopicId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockMessageDeleteMessagesBySession).not.toHaveBeenCalled();
    });

    it('message.removeMessagesByGroup rejects a visitor topic with NOT_FOUND', async () => {
      await expect(
        messageCaller().removeMessagesByGroup({ groupId: 'group-1', topicId: visitorTopicId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockMessageDeleteMessagesBySession).not.toHaveBeenCalled();
    });

    it('message.cancelCompression rejects a visitor topic with NOT_FOUND', async () => {
      await expect(
        messageCaller().cancelCompression({
          agentId: 'agent-1',
          messageGroupId: 'group-1',
          topicId: visitorTopicId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockServiceCancelCompression).not.toHaveBeenCalled();
    });

    it('message.createCompressionGroup rejects a visitor topic with NOT_FOUND', async () => {
      await expect(
        messageCaller().createCompressionGroup({
          agentId: 'agent-1',
          messageIds: ['msg-1'],
          topicId: visitorTopicId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockServiceCreateCompressionGroup).not.toHaveBeenCalled();
    });

    it('message.finalizeCompression rejects a visitor topic with NOT_FOUND', async () => {
      await expect(
        messageCaller().finalizeCompression({
          agentId: 'agent-1',
          content: 'summary',
          messageGroupId: 'group-1',
          topicId: visitorTopicId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockServiceFinalizeCompression).not.toHaveBeenCalled();
    });

    it('message.updateMessageGroupMetadata rejects a visitor topic with NOT_FOUND', async () => {
      await expect(
        messageCaller().updateMessageGroupMetadata({
          context: { agentId: 'agent-1', topicId: visitorTopicId },
          expanded: true,
          messageGroupId: 'group-1',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockServiceUpdateMessageGroupMetadata).not.toHaveBeenCalled();
    });
  });

  // Creation paths name no existing message id, but they can still reach a
  // visitor transcript: a new message can be appended INTO a visitor topic,
  // and a new topic can ADOPT visitor messages (reparenting them out of the
  // `senderId` scope the visitor predicates key on).
  describe('creation paths', () => {
    beforeEach(() => {
      mockTopicFindShareVisitorTopicIds.mockImplementation(async (ids: string[]) =>
        ids.filter((id) => id === visitorTopicId),
      );
      mockMessageFindShareVisitorMessageIds.mockImplementation(async (ids: string[]) =>
        ids.filter((id) => id === visitorMessageId),
      );
    });

    it('message.createMessage rejects a visitor topic with NOT_FOUND', async () => {
      await expect(
        messageCaller().createMessage({
          agentId: 'agent-1',
          content: 'injected',
          role: 'user',
          topicId: visitorTopicId,
        } as any),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockServiceCreateMessage).not.toHaveBeenCalled();
    });

    it('message.batchMutate rejects a createMessage into a visitor topic with NOT_FOUND', async () => {
      await expect(
        messageCaller().batchMutate({
          operations: [
            {
              message: { agentId: 'agent-1', content: 'x', role: 'user', topicId: visitorTopicId },
              type: 'createMessage',
            } as any,
          ],
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockServiceBatchMutate).not.toHaveBeenCalled();
    });

    it('topic.createTopic rejects adopting a visitor message with NOT_FOUND', async () => {
      await expect(
        topicCaller().createTopic({
          agentId: 'agent-1',
          messages: ['msg-1', visitorMessageId],
          title: 'stolen',
        } as any),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockTopicCreate).not.toHaveBeenCalled();
    });

    it('topic.batchCreateTopics rejects adopting a visitor message with NOT_FOUND', async () => {
      await expect(
        topicCaller().batchCreateTopics([
          { agentId: 'agent-1', messages: ['msg-1'], title: 'fine' },
          { agentId: 'agent-1', messages: [visitorMessageId], title: 'stolen' },
        ] as any),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockTopicBatchCreate).not.toHaveBeenCalled();
    });

    it('still lets the creator create a topic adopting their own messages', async () => {
      mockTopicCreate.mockResolvedValue({ id: 'topic-new' });

      await topicCaller().createTopic({
        agentId: 'agent-1',
        messages: ['msg-1'],
        title: 'ok',
      } as any);

      expect(mockTopicCreate).toHaveBeenCalled();
    });
  });
});
