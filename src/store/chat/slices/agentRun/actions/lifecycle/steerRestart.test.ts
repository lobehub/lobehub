import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueuedMessage } from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';

import type * as SendQueuedNow from './sendQueuedNow';
import { sendQueuedMessagesNow } from './sendQueuedNow';
import { createSteerRestart } from './steerRestart';

const restart = vi.hoisted(() => ({ value: true }));
vi.mock('./followUpMode', () => ({ getRestartUnsteerableRun: () => restart.value }));
vi.mock('./sendQueuedNow', async (importOriginal) => ({
  ...(await importOriginal<typeof SendQueuedNow>()),
  sendQueuedMessagesNow: vi.fn(async () => 'sent' as const),
}));

const context = { agentId: 'agent-1', topicId: 'topic-1' };

const queued = (id: string, extra: Partial<QueuedMessage> = {}): QueuedMessage => ({
  content: id,
  createdAt: 1,
  id,
  interruptMode: 'soft',
  ...extra,
});

/** A store with one running operation and a queue, notifying on every change. */
const createHarness = (metadata: Record<string, unknown> = { steerUnsupported: true }) => {
  let queue: QueuedMessage[] = [];
  let operation = { id: 'op-1', metadata, status: 'running' };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const store = {
    get operations() {
      return { 'op-1': operation };
    },
    get queuedMessages() {
      return { key: queue };
    },
    withdrawQueuedMessage: vi.fn(async () => true),
  } as unknown as ChatStore;
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  createSteerRestart({
    context,
    contextKey: 'key',
    get: () => store,
    operationId: 'op-1',
    subscribe,
  });
  return {
    listeners,
    setOperation: (patch: Partial<typeof operation>) => {
      operation = { ...operation, ...patch };
      notify();
    },
    setQueue: (next: QueuedMessage[]) => {
      queue = next;
      notify();
    },
    store,
  };
};

const sendNow = vi.mocked(sendQueuedMessagesNow);

beforeEach(() => {
  restart.value = true;
  sendNow.mockReset();
  sendNow.mockResolvedValue('sent');
});

describe('createSteerRestart', () => {
  it('stops the run and restarts with every waiting follow-up, taking arrivals along', async () => {
    const { setQueue, store } = createHarness();
    setQueue([queued('a'), queued('b')]);

    await vi.waitFor(() => expect(sendNow).toHaveBeenCalledOnce());
    expect(sendNow).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        contextKey: 'key',
        msgs: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })],
        takeArrivals: true,
      }),
    );
    // Withdraws through the store, so a server-held follow-up comes back too.
    await sendNow.mock.calls[0][0].withdraw(queued('a'));
    expect(store.withdrawQueuedMessage).toHaveBeenCalledWith('key', 'a');
  });

  it('does nothing while the option is off or the mode is Queue', () => {
    restart.value = false;
    const { setQueue } = createHarness();
    setQueue([queued('a')]);

    expect(sendNow).not.toHaveBeenCalled();
  });

  it('does nothing for a run that can steer', () => {
    const { setQueue } = createHarness({});
    setQueue([queued('a')]);

    expect(sendNow).not.toHaveBeenCalled();
  });

  it('restarts once the run is found unable to steer after the follow-up queued', async () => {
    const { setOperation, setQueue } = createHarness({});
    setQueue([queued('a')]);
    expect(sendNow).not.toHaveBeenCalled();

    setOperation({ metadata: { steerUnsupported: true } });

    await vi.waitFor(() => expect(sendNow).toHaveBeenCalledOnce());
  });

  it('starts one restart at a time: a follow-up during the stop joins it', async () => {
    const stopping = Promise.withResolvers<'sent'>();
    sendNow.mockReturnValueOnce(stopping.promise);
    const { setQueue } = createHarness();
    setQueue([queued('a')]);
    await vi.waitFor(() => expect(sendNow).toHaveBeenCalledOnce());

    setQueue([queued('a'), queued('late')]);
    expect(sendNow).toHaveBeenCalledOnce();
    stopping.resolve('sent');
  });

  it('leaves follow-ups already on their way into the run alone', () => {
    const { setQueue } = createHarness();
    setQueue([
      queued('server', { serverDelivering: true, serverDelivery: 'server' }),
      queued('steer', { localSteer: 'unknown' }),
    ]);

    expect(sendNow).not.toHaveBeenCalled();
  });

  it('stops watching once the run ends', () => {
    const { listeners, setOperation, setQueue } = createHarness();
    setOperation({ status: 'cancelled' });
    expect(listeners.size).toBe(0);

    setQueue([queued('a')]);
    expect(sendNow).not.toHaveBeenCalled();
  });

  it('logs a failed restart; the send already put the follow-ups back', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendNow.mockRejectedValueOnce(new Error('not confirmed'));
    const { setQueue } = createHarness();
    setQueue([queued('a')]);

    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    error.mockRestore();
  });
});
