import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/** Every watch a test started, stopped after it so none carries into the next. */
const watchers: Array<{ stop: () => void }> = [];

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
  watchers.push(
    createSteerRestart({
      context,
      contextKey: 'key',
      get: () => store,
      operationId: 'op-1',
      subscribe,
    }),
  );
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

afterEach(async () => {
  watchers.splice(0).forEach((watcher) => watcher.stop());
  // Let a restart a test left resolving release its guard.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

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

  // ROOT CAUSE:
  //
  // The restart guard was released only when the restart's send resolved, and
  // a local heterogeneous send resolves when its whole run ends. The run the
  // restart started could therefore never be restarted itself: a follow-up
  // sent during it waited for its end.
  //
  // Before: the guard was held until the replacement run finished.
  // After: it is released once the replacement message is accepted.
  it('lets the replacement run restart again once its message is accepted', async () => {
    const first = createHarness();
    sendNow.mockImplementationOnce(async (params) => {
      // The restart stopped the first run before its message was accepted.
      first.setOperation({ status: 'cancelled' });
      params.onAccepted?.();
      // The replacement run is still going: the send has not resolved.
      return new Promise<'sent'>(() => {});
    });
    first.setQueue([queued('a')]);
    await vi.waitFor(() => expect(sendNow).toHaveBeenCalledOnce());

    // The run the restart started, unable to steer too, gets a follow-up.
    const replacement = createHarness();
    replacement.setQueue([queued('b')]);

    await vi.waitFor(() => expect(sendNow).toHaveBeenCalledTimes(2));
    expect(sendNow.mock.calls[1][0].msgs).toEqual([expect.objectContaining({ id: 'b' })]);
  });

  it('restarts what queued behind the replacement run before its message was accepted', async () => {
    const accepted = Promise.withResolvers<void>();
    const first = createHarness();
    sendNow.mockImplementationOnce(async (params) => {
      await accepted.promise;
      first.setOperation({ status: 'cancelled' });
      params.onAccepted?.();
      return new Promise<'sent'>(() => {});
    });
    first.setQueue([queued('a')]);
    await vi.waitFor(() => expect(sendNow).toHaveBeenCalledOnce());

    // Queued while the guard is held: skipped then, picked up on release.
    const replacement = createHarness();
    replacement.setQueue([queued('b')]);
    expect(sendNow).toHaveBeenCalledOnce();

    accepted.resolve();
    await vi.waitFor(() => expect(sendNow).toHaveBeenCalledTimes(2));
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

  it('does not retry a failed restart on its own', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendNow.mockRejectedValueOnce(new Error('not confirmed'));
    const { setQueue } = createHarness();
    setQueue([queued('a')]);

    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendNow).toHaveBeenCalledOnce();
    error.mockRestore();
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
