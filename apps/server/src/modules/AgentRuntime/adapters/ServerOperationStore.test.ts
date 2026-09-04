import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';

import { ServerOperationStore } from './ServerOperationStore';

const topicMock = {
  findById: vi.fn(),
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

const markedWith = (operationId: string) => ({
  metadata: { runningOperation: { assistantMessageId: 'asst-1', operationId } },
});

describe('ServerOperationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    topicMock.settleRunningOperation.mockResolvedValue({ status: 'settled' });
  });

  describe('clearRunningMark', () => {
    // Regression: agent-share visitor runs execute under the creator's userId
    // on a topic whose `senderId` is the visitor. The default topic scope hides
    // those rows, so `findById` returned nothing, the clear silently bailed,
    // and every visitor topic kept a stale `runningOperation` forever — each
    // later open reconnected to a finished run and froze the message list.
    it('looks the topic up with the share-visitor scope so visitor topics can be cleared', async () => {
      topicMock.findById.mockResolvedValue(markedWith('op-main'));

      await createStore('op-main').clearRunningMark();

      expect(TopicModel).toHaveBeenCalledWith(db, 'user-1', undefined, undefined, {
        includeShareVisitor: true,
      });
      expect(topicMock.settleRunningOperation).toHaveBeenCalledWith('topic-1', 'op-main', 'unread');
    });

    it('clears the mark when this operation owns it', async () => {
      topicMock.findById.mockResolvedValue(markedWith('op-main'));

      await createStore('op-main').clearRunningMark();

      expect(topicMock.settleRunningOperation).toHaveBeenCalledWith('topic-1', 'op-main', 'unread');
    });

    // The bug this adapter caused: `finish` calls clearRunningMark BEFORE it
    // publishes `execution_complete`, and the client only learns the run ended
    // from that event — so the client's own settle always arrived to a mark this
    // method had already dropped and returned 'missing'. Dropping the mark
    // without writing a status therefore stranded `topics.status` on 'running'
    // permanently: the one field a later settle matches on was gone. Observed on
    // a self-hosted deployment as topics stuck 'running' whose
    // `metadata.runningOperation` was present-and-JSON-null, operation rows
    // already terminal, and the topic's last write landing ~100ms BEFORE the
    // operation was finalised — i.e. this very call.
    it('writes the terminal status with the clear, not just the mark', async () => {
      topicMock.findById.mockResolvedValue(markedWith('op-main'));

      await createStore('op-main').clearRunningMark();

      // 'unread' is the honest terminal state here: the run finished and nothing
      // on the server proves the user watched it. The client corrects to
      // 'active' when it knows better.
      expect(topicMock.settleRunningOperation).toHaveBeenCalledWith('topic-1', 'op-main', 'unread');
    });

    it('leaves the mark alone when it belongs to another operation', async () => {
      // Regression: a `callSubAgent` / group-member child runs in an isolation
      // thread on its PARENT's topic and finishes minutes before the parent. The
      // unconditional clear wiped the parent's reconnect anchor mid-run, so every
      // later client open saw no `runningOperation`, never opened a gateway
      // WebSocket, and rendered a frozen REST snapshot until the run ended.
      topicMock.findById.mockResolvedValue(markedWith('op-parent'));

      await createStore('op-child').clearRunningMark();

      expect(topicMock.settleRunningOperation).not.toHaveBeenCalled();
    });

    it('is a no-op when the topic carries no mark', async () => {
      topicMock.findById.mockResolvedValue({ metadata: {} });

      await createStore('op-main').clearRunningMark();

      expect(topicMock.settleRunningOperation).not.toHaveBeenCalled();
    });

    it('skips the lookup entirely without a topic', async () => {
      await createTopiclessStore().clearRunningMark();

      expect(topicMock.findById).not.toHaveBeenCalled();
      expect(topicMock.settleRunningOperation).not.toHaveBeenCalled();
    });

    it('swallows lookup failures — clearing the mark is best-effort', async () => {
      topicMock.findById.mockRejectedValue(new Error('db down'));

      await expect(createStore('op-main').clearRunningMark()).resolves.toBeUndefined();
      expect(topicMock.settleRunningOperation).not.toHaveBeenCalled();
    });

    it('takes a matching child marker without clearing its parent', async () => {
      topicMock.findById.mockResolvedValue({
        metadata: {
          runningOperation: {
            ...markedWith('op-parent').metadata.runningOperation,
            childOperations: [{ assistantMessageId: 'asst-child', operationId: 'op-child' }],
          },
        },
      });

      await createStore('op-child').clearRunningMark();

      expect(topicMock.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'op-child',
        'unread',
      );
    });
  });
});
