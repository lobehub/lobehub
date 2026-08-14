import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { ServerOperationStore } from './ServerOperationStore';

const topicMock = {
  findById: vi.fn(),
  updateMetadata: vi.fn(),
};

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => topicMock),
}));

const db = {} as LobeChatDatabase;

const createStore = (operationId: string | undefined, topicId: string | undefined = 'topic-1') =>
  new ServerOperationStore(db, 'user-1', undefined, topicId, operationId);

const createTopiclessStore = () =>
  new ServerOperationStore(db, 'user-1', undefined, undefined, 'op-main');

const markedWith = (operationId: string) => ({
  metadata: { runningOperation: { assistantMessageId: 'asst-1', operationId } },
});

describe('ServerOperationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    topicMock.updateMetadata.mockResolvedValue(undefined);
  });

  describe('clearRunningMark', () => {
    it('clears the mark when this operation owns it', async () => {
      topicMock.findById.mockResolvedValue(markedWith('op-main'));

      await createStore('op-main').clearRunningMark();

      expect(topicMock.updateMetadata).toHaveBeenCalledWith('topic-1', { runningOperation: null });
    });

    it('leaves the mark alone when it belongs to another operation', async () => {
      // Regression: a `callSubAgent` / group-member child runs in an isolation
      // thread on its PARENT's topic and finishes minutes before the parent. The
      // unconditional clear wiped the parent's reconnect anchor mid-run, so every
      // later client open saw no `runningOperation`, never opened a gateway
      // WebSocket, and rendered a frozen REST snapshot until the run ended.
      topicMock.findById.mockResolvedValue(markedWith('op-parent'));

      await createStore('op-child').clearRunningMark();

      expect(topicMock.updateMetadata).not.toHaveBeenCalled();
    });

    it('is a no-op when the topic carries no mark', async () => {
      topicMock.findById.mockResolvedValue({ metadata: {} });

      await createStore('op-main').clearRunningMark();

      expect(topicMock.updateMetadata).not.toHaveBeenCalled();
    });

    it('skips the lookup entirely without a topic', async () => {
      await createTopiclessStore().clearRunningMark();

      expect(topicMock.findById).not.toHaveBeenCalled();
      expect(topicMock.updateMetadata).not.toHaveBeenCalled();
    });

    it('swallows lookup failures — clearing the mark is best-effort', async () => {
      topicMock.findById.mockRejectedValue(new Error('db down'));

      await expect(createStore('op-main').clearRunningMark()).resolves.toBeUndefined();
      expect(topicMock.updateMetadata).not.toHaveBeenCalled();
    });
  });
});
