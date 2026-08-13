import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { ServerOperationStore } from './ServerOperationStore';

const topicMock = {
  clearRunningOperationIfMatches: vi.fn(),
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
    topicMock.clearRunningOperationIfMatches.mockResolvedValue(true);
  });

  describe('clearRunningMark', () => {
    it('clears the mark when this operation owns it', async () => {
      await createStore('op-main').clearRunningMark();

      expect(topicMock.clearRunningOperationIfMatches).toHaveBeenCalledWith('topic-1', 'op-main');
    });

    it('leaves the mark alone when it belongs to another operation', async () => {
      // Regression: a `callSubAgent` / group-member child runs in an isolation
      // thread on its PARENT's topic and finishes minutes before the parent. The
      // unconditional clear wiped the parent's reconnect anchor mid-run, so every
      // later client open saw no `runningOperation`, never opened a gateway
      // WebSocket, and rendered a frozen REST snapshot until the run ended.
      topicMock.clearRunningOperationIfMatches.mockResolvedValue(false);

      await createStore('op-child').clearRunningMark();

      expect(topicMock.clearRunningOperationIfMatches).toHaveBeenCalledWith('topic-1', 'op-child');
    });

    it('skips the compare-and-clear entirely without a topic', async () => {
      await createTopiclessStore().clearRunningMark();

      expect(topicMock.clearRunningOperationIfMatches).not.toHaveBeenCalled();
    });

    it('swallows compare-and-clear failures — clearing the mark is best-effort', async () => {
      topicMock.clearRunningOperationIfMatches.mockRejectedValue(new Error('db down'));

      await expect(createStore('op-main').clearRunningMark()).resolves.toBeUndefined();
    });
  });
});
