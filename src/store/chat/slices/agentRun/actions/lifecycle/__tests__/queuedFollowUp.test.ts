import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueuedMessage } from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';

import { drainQueuedTurn, findOrphanedQueueKey, scheduleQueuedFollowUp } from '../queuedFollowUp';

const mode = vi.hoisted(() => ({ value: 'steer' as 'queue' | 'steer' }));
vi.mock('../followUpMode', () => ({ getFollowUpMode: () => mode.value }));

const queued = (
  id: string,
  content: string,
  extra: Partial<QueuedMessage> = {},
): QueuedMessage => ({
  content,
  createdAt: Number(id.slice(1)),
  id,
  interruptMode: 'soft',
  ...extra,
});

const createStore = (messages: QueuedMessage[]) => {
  const state = { queue: [...messages] };
  const store = {
    drainQueuedMessages: vi.fn((_key: string, options?: { limit?: number }) => {
      const taken = options?.limit ? state.queue.slice(0, options.limit) : [...state.queue];
      state.queue = state.queue.slice(taken.length);
      return taken;
    }),
    operations: {},
    operationsByContext: {},
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatStore;
  return { get: () => store, state, store };
};

describe('drainQueuedTurn', () => {
  it('takes the whole queue as one turn outside Queue mode', () => {
    mode.value = 'steer';
    const { get, state } = createStore([queued('q1', 'a'), queued('q2', 'b')]);

    const turn = drainQueuedTurn(get, 'key');

    expect(turn.messages.map((m) => m.id)).toEqual(['q1', 'q2']);
    expect(turn.queueHead).toBeUndefined();
    expect(state.queue).toEqual([]);
  });

  it('takes only the head in Queue mode and leaves the rest queued', () => {
    mode.value = 'queue';
    const { get, state } = createStore([queued('q1', 'a'), queued('q2', 'b')]);

    const turn = drainQueuedTurn(get, 'key');

    expect(turn.messages.map((m) => m.id)).toEqual(['q1']);
    expect(turn.queueHead).toBe(true);
    expect(state.queue.map((m) => m.id)).toEqual(['q2']);
  });
});

describe('scheduleQueuedFollowUp', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const context = { agentId: 'agent-1', topicId: 'topic-1' };

  it('merges everything queued into one send in Steer mode', () => {
    mode.value = 'steer';
    const { get, store } = createStore([queued('q1', 'first'), queued('q2', 'second')]);

    scheduleQueuedFollowUp(get, context, 'op-1');
    vi.advanceTimersByTime(100);

    expect(store.sendMessage).toHaveBeenCalledTimes(1);
    const params = vi.mocked(store.sendMessage).mock.calls[0][0];
    expect(params.message).toBe('first\n\nsecond');
    expect(params.queueHead).toBeUndefined();
  });

  it('sends one message per turn in Queue mode, marking it the queue head', () => {
    mode.value = 'queue';
    const { get, state, store } = createStore([queued('q1', 'first'), queued('q2', 'second')]);

    scheduleQueuedFollowUp(get, context, 'op-1');
    vi.advanceTimersByTime(100);

    expect(store.sendMessage).toHaveBeenCalledTimes(1);
    const params = vi.mocked(store.sendMessage).mock.calls[0][0];
    expect(params.message).toBe('first');
    expect(params.queueHead).toBe(true);
    expect(state.queue.map((m) => m.id)).toEqual(['q2']);
  });
});

describe('findOrphanedQueueKey', () => {
  it('ignores a steer that may already be with the agent', () => {
    const { get } = createStore([queued('q1', 'maybe', { localSteer: 'unknown' } as any)]);
    (get() as any).queuedMessages = {
      key: [queued('q1', 'maybe', { localSteer: 'unknown' } as any)],
    };

    expect(findOrphanedQueueKey(get, ['key'], false)).toBeUndefined();
  });

  it('still finds a queue a send must take along', () => {
    const { get } = createStore([]);
    (get() as any).queuedMessages = { key: [queued('q1', 'waiting')] };

    expect(findOrphanedQueueKey(get, ['key'], false)).toBe('key');
  });
});
