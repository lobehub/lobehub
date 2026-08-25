import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { ServerOperationStore } from './ServerOperationStore';

const topicMock = {
  settleRunningOperation: vi.fn(),
};

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => topicMock),
}));

const db = {} as LobeChatDatabase;

const createStore = (operationId: string | undefined, topicId: string | undefined = 'topic-1') =>
  new ServerOperationStore(db, 'user-1', undefined, topicId, operationId);

const createTopiclessStore = () =>
  new ServerOperationStore(db, 'user-1', undefined, undefined, 'op-main');

describe('ServerOperationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    topicMock.settleRunningOperation.mockResolvedValue(undefined);
  });

  describe('clearRunningMark', () => {
    it('atomically clears and settles the operation', async () => {
      await createStore('op-main').clearRunningMark();

      expect(topicMock.settleRunningOperation).toHaveBeenCalledWith('topic-1', 'op-main');
    });

    it('delegates child ownership handling to the atomic model operation', async () => {
      // Regression: a `callSubAgent` / group-member child runs in an isolation
      // thread on its PARENT's topic and finishes minutes before the parent. The
      // unconditional clear wiped the parent's reconnect anchor mid-run, so every
      // later client open saw no `runningOperation`, never opened a gateway
      // WebSocket, and rendered a frozen REST snapshot until the run ended.
      await createStore('op-child').clearRunningMark();

      expect(topicMock.settleRunningOperation).toHaveBeenCalledWith('topic-1', 'op-child');
    });

    it('skips the lookup entirely without a topic', async () => {
      await createTopiclessStore().clearRunningMark();

      expect(topicMock.settleRunningOperation).not.toHaveBeenCalled();
    });

    it('swallows settlement failures — clearing the mark is best-effort', async () => {
      topicMock.settleRunningOperation.mockRejectedValue(new Error('db down'));

      await expect(createStore('op-main').clearRunningMark()).resolves.toBeUndefined();
    });
  });
});
