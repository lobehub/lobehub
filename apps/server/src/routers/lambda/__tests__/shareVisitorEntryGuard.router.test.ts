// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mocks
// ignore the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

const mockTopicFindOwnTopicById = vi.fn();
const mockTopicFindShareVisitorTopicIds = vi.fn();
const mockTopicDelete = vi.fn();
const mockTopicUpdate = vi.fn();
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(() => ({
    delete: mockTopicDelete,
    findOwnTopicById: mockTopicFindOwnTopicById,
    findShareVisitorTopicIds: mockTopicFindShareVisitorTopicIds,
    update: mockTopicUpdate,
  })),
}));

const mockMessageFindShareVisitorMessageIds = vi.fn();
const mockMessageUpdateTTS = vi.fn();
const mockMessageUpdateTranslate = vi.fn();
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({
    findShareVisitorMessageIds: mockMessageFindShareVisitorMessageIds,
    updateTTS: mockMessageUpdateTTS,
    updateTranslate: mockMessageUpdateTranslate,
  })),
}));

const mockServiceBatchMutate = vi.fn();
const mockServiceUpdateMessage = vi.fn();
const mockServiceUpdateMessagePlugin = vi.fn();
vi.mock('@/server/services/message', () => ({
  MessageService: vi.fn(() => ({
    batchMutate: mockServiceBatchMutate,
    updateMessage: mockServiceUpdateMessage,
    updateMessagePlugin: mockServiceUpdateMessagePlugin,
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

    it('lets the creator update their own message', async () => {
      mockMessageFindShareVisitorMessageIds.mockResolvedValue([]);
      mockServiceUpdateMessage.mockResolvedValue({ messages: [], success: true });

      await messageCaller().update({ id: 'msg-1', value: { content: 'ok' } });

      expect(mockServiceUpdateMessage).toHaveBeenCalled();
    });
  });
});
