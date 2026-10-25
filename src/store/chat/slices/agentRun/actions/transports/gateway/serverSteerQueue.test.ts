import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService, type QueuedFollowUpRequest } from '@/services/aiAgent';
import { topicService } from '@/services/topic';
import type { QueuedMessage } from '@/store/chat/slices/operation/types';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import {
  canQueueOnServer,
  handOffQueuedMessage,
  reclaimServerQueuedMessages,
  restoreServerQueuedMessages,
  SERVER_QUEUE_POLL_MS,
  watchServerQueue,
  withdrawQueuedMessage,
} from './serverSteerQueue';

const context = { agentId: 'agt-1', topicId: 'tpc-1' };
const key = messageMapKey(context);
const request: QueuedFollowUpRequest = {
  agentId: 'agt-1',
  appContext: { topicId: 'tpc-1' },
  prompt: 'next',
};

const get = () => useChatStore.getState();
const queued = (id: string, patch: Partial<QueuedMessage> = {}): QueuedMessage => ({
  content: id,
  // Queued just now: an unconfirmed row past a day is dropped, not settled.
  createdAt: Date.now(),
  id,
  interruptMode: 'soft',
  ...patch,
});
const queue = () => get().queuedMessages[key] ?? [];
/** One entry of `agentSteerQueue.list`. */
const pending = (id: string, patch: Record<string, unknown> = {}) =>
  ({ createdAt: 1, delivering: false, fileIds: undefined, id, prompt: id, ...patch }) as any;

beforeEach(() => {
  vi.useFakeTimers();
  useChatStore.setState(useChatStore.getInitialState());
  useChatStore.setState({ isGatewayModeEnabled: () => true });
  vi.spyOn(aiAgentService, 'setQueuedMessages').mockResolvedValue(undefined as never);
  vi.spyOn(aiAgentService, 'listQueuedFollowUps').mockResolvedValue([]);
});

afterEach(async () => {
  // An emptied tray ends any watch a test left running.
  useChatStore.setState(useChatStore.getInitialState());
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const startRun = () =>
  get().startOperation({
    context,
    metadata: { serverOperationId: 'op-server' },
    type: 'execServerAgentRuntime',
  });

describe('canQueueOnServer', () => {
  it('queues behind a Gateway run on an existing main-topic conversation', () => {
    expect(canQueueOnServer(get, key, { context, isGatewayRun: true })).toBe(true);
  });

  it.each([
    ['the run is not on the Gateway', () => {}, context, false],
    ['the conversation is a thread', () => {}, { ...context, threadId: 'thd-1' }, true],
    ['the visitor is on a share', () => {}, { ...context, agentShareId: 'shr-1' }, true],
    // The server queue is per topic: these share one topic between several
    // message buckets it cannot tell apart.
    ['it is a group conversation', () => {}, { ...context, groupId: 'grp-1' }, true],
    [
      'it is one group member’s stream',
      () => {},
      { ...context, groupId: 'grp-1', scope: 'group_agent' as const, subAgentId: 'agt-2' },
      true,
    ],
    [
      'it is a page document’s conversation',
      () => {},
      { ...context, documentId: 'doc-1', scope: 'page' as const },
      true,
    ],
  ])('keeps the send here when %s', (_label, arrange, ctx, isGatewayRun) => {
    arrange();
    expect(canQueueOnServer(get, key, { context: ctx, isGatewayRun })).toBe(false);
  });

  it('keeps it here behind a message only this client holds, so it cannot overtake it', () => {
    get().enqueueMessage(key, queued('first'));
    expect(canQueueOnServer(get, key, { context, isGatewayRun: true })).toBe(false);
  });
});

describe('handOffQueuedMessage', () => {
  it('hands the follow-up to the server and leaves the run unflagged, so it joins instead of handing back', async () => {
    startRun();
    const append = vi
      .spyOn(aiAgentService, 'appendQueuedFollowUp')
      .mockResolvedValue({ id: 'q1', length: 1, queued: true });
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);

    expect(append).toHaveBeenCalledWith(expect.objectContaining({ id: 'q1', request }));
    expect(queue()[0]).toMatchObject({ serverDelivery: 'server', serverRequest: request });
    expect(aiAgentService.setQueuedMessages).not.toHaveBeenCalled();
    // The server delivers it; the client's own drain takes nothing.
    expect(get().drainQueuedMessages(key)).toEqual([]);
  });

  it('keeps the follow-up here and flags the run when no run of ours is live on the server', async () => {
    startRun();
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      queued: false,
      reason: 'idle',
    });
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);

    expect(queue()[0].serverDelivery).toBeUndefined();
    expect(aiAgentService.setQueuedMessages).toHaveBeenCalledWith({
      operationId: 'op-server',
      pending: true,
    });
  });

  it('sends a kept follow-up itself when the run ended while it was being queued', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage });
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      queued: false,
      reason: 'idle',
    });
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);
    await vi.advanceTimersByTimeAsync(200);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'q1', metadata: { steer: true } }),
    );
  });

  it('retries an append whose outcome is unknown with the same id', async () => {
    startRun();
    const unavailable = new TRPCClientError('unknown', {
      result: { error: { data: { code: 'SERVICE_UNAVAILABLE' } } } as any,
    });
    Object.assign(unavailable, { data: { code: 'SERVICE_UNAVAILABLE' } });
    const append = vi
      .spyOn(aiAgentService, 'appendQueuedFollowUp')
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ id: 'q1', length: 1, queued: true });
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);

    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[1][0].id).toBe('q1');
    expect(queue()[0].serverDelivery).toBe('server');
  });

  // ROOT CAUSE:
  //
  // An append that committed but whose answers all failed fell back to this
  // client, which then sent it after the run while the server delivered its
  // copy too — the follow-up (and any tool side effects) ran twice.
  //
  // Before: an unknown outcome kept it here.
  // After: it stays the server's until the same id is appended again and the
  // server says where it is.
  it('keeps an append with an unknown outcome the server’s and settles it by its id', async () => {
    const unavailable = Object.assign(new Error('unknown'), {
      data: { code: 'SERVICE_UNAVAILABLE' },
    });
    const append = vi
      .spyOn(aiAgentService, 'appendQueuedFollowUp')
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ id: 'q1', length: 1, queued: true });
    startRun();
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);

    expect(queue()[0]).toMatchObject({ serverDelivery: 'server', serverUnconfirmed: true });
    expect(get().drainQueuedMessages(key)).toEqual([]);

    // Not listed: append the same id again; the server says it is waiting.
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS);
    expect(append).toHaveBeenCalledTimes(4);
    expect(append.mock.calls[3][0].id).toBe('q1');
    expect(queue()[0]).toMatchObject({ serverDelivery: 'server', serverUnconfirmed: undefined });
  });

  // ROOT CAUSE:
  //
  // An unconfirmed follow-up the retry found already delivered was just
  // dropped: the watch skipped its delivery handling, so the run the server
  // started was not picked up and what was queued here behind it never sent.
  //
  // Before: `taken` on reconcile removed the row only.
  // After: it completes like any delivered follow-up.
  it('completes an unconfirmed follow-up the server says it delivered, and sends what waited behind', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage });
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      id: 'q1',
      length: 0,
      queued: true,
      state: 'taken',
    } as any);
    get().enqueueMessage(
      key,
      queued('q1', { serverDelivery: 'server', serverRequest: request, serverUnconfirmed: true }),
    );
    get().enqueueMessage(key, queued('q2', { createdAt: 2 }));
    // No next run was started for it in this test.
    vi.spyOn(topicService, 'getTopicDetail').mockResolvedValue(null);
    watchServerQueue(get, key, context);

    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS * 8);

    expect(queue().map((m) => m.id)).not.toContain('q1');
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ message: 'q2' }));
  });

  // ROOT CAUSE:
  //
  // The server remembers delivered ids for a day. A tab suspended longer
  // retried its unconfirmed append, got `idle` (the marker had expired) and
  // sent it again, though it may well have run.
  //
  // Before: an unconfirmed row could fall back here at any age.
  // After: past that window it is dropped, never sent from here.
  it('drops an unconfirmed follow-up too old to settle by its id, without sending it', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage });
    const append = vi
      .spyOn(aiAgentService, 'appendQueuedFollowUp')
      .mockResolvedValue({ queued: false, reason: 'idle' } as any);
    get().enqueueMessage(
      key,
      queued('q1', {
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
        serverDelivery: 'server',
        serverRequest: request,
        serverUnconfirmed: true,
      }),
    );
    vi.spyOn(topicService, 'getTopicDetail').mockResolvedValue(null);
    watchServerQueue(get, key, context);

    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS * 8);

    expect(append).not.toHaveBeenCalled();
    expect(queue()).toHaveLength(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('keeps an unconfirmed follow-up the server says is on its way, now confirmed', async () => {
    startRun();
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      id: 'q1',
      length: 0,
      queued: true,
      state: 'delivering',
    } as any);
    get().enqueueMessage(
      key,
      queued('q1', { serverDelivery: 'server', serverRequest: request, serverUnconfirmed: true }),
    );
    watchServerQueue(get, key, context);

    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS);

    expect(queue()[0]).toMatchObject({ serverDelivery: 'server', serverUnconfirmed: undefined });
  });

  it('sends an unconfirmed follow-up here only once the server says it never held it', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage });
    const unavailable = Object.assign(new Error('unknown'), {
      data: { code: 'SERVICE_UNAVAILABLE' },
    });
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp')
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ queued: false, reason: 'idle' });
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);
    // A client-held follow-up behind no run would be sent within 100ms.
    await vi.advanceTimersByTimeAsync(300);
    expect(sendMessage).not.toHaveBeenCalled();

    // The next check appends the id again; the server never held it.
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('withdraws from the server a follow-up removed from the tray while it was being queued', async () => {
    startRun();
    let resolveAppend!: (value: { id: string; length: number; queued: true }) => void;
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockReturnValue(
      new Promise((resolve) => (resolveAppend = resolve)),
    );
    const remove = vi
      .spyOn(aiAgentService, 'removeQueuedFollowUp')
      .mockResolvedValue({ removed: true, state: 'removed' });
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    const handOff = handOffQueuedMessage(get, key, context, 'q1', async () => request);
    await vi.waitFor(() => expect(aiAgentService.appendQueuedFollowUp).toHaveBeenCalled());
    get().removeQueuedMessage(key, 'q1');
    resolveAppend({ id: 'q1', length: 1, queued: true });
    await handOff;

    expect(remove).toHaveBeenCalledWith({ id: 'q1', threadId: null, topicId: 'tpc-1' });
  });
});

describe('server queue watch', () => {
  it('drops each follow-up from the tray once the server took it into the run', async () => {
    startRun();
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      id: 'q1',
      length: 1,
      queued: true,
    });
    const list = vi
      .spyOn(aiAgentService, 'listQueuedFollowUps')
      .mockResolvedValueOnce([pending('q1', { createdAt: 1, prompt: 'q1' })])
      .mockResolvedValue([]);
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS);
    expect(queue()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS);
    expect(list).toHaveBeenCalledWith({ threadId: null, topicId: 'tpc-1' });
    expect(queue()).toHaveLength(0);
  });
});

describe('server queue watch while a run delivers', () => {
  // ROOT CAUSE:
  //
  // A drained follow-up left the waiting list before its run confirmed it, and
  // the watch dropped it from the tray then. A failed delivery returns it to
  // the queue, where it waited unseen until another run or a reload.
  //
  // Before: absence from the waiting list counted as delivered.
  // After: one listed as `delivering` stays until it is gone from both.
  it('keeps a follow-up the run took but has not confirmed, and one it gave back', async () => {
    startRun();
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      id: 'q1',
      length: 1,
      queued: true,
    });
    const list = vi
      .spyOn(aiAgentService, 'listQueuedFollowUps')
      .mockResolvedValueOnce([pending('q1', { delivering: true })])
      .mockResolvedValueOnce([pending('q1')])
      .mockResolvedValue([]);
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS);
    expect(queue()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS);
    expect(queue()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS);
    expect(list).toHaveBeenCalledTimes(3);
    expect(queue()).toHaveLength(0);
  });

  it('keeps every follow-up while the queue cannot be read, rather than taking them as delivered', async () => {
    startRun();
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      id: 'q1',
      length: 1,
      queued: true,
    });
    vi.spyOn(aiAgentService, 'listQueuedFollowUps').mockRejectedValue(
      Object.assign(new Error('Queue unavailable'), { data: { code: 'SERVICE_UNAVAILABLE' } }),
    );
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS * 3);

    expect(queue()).toEqual([expect.objectContaining({ id: 'q1', serverDelivery: 'server' })]);
  });

  it('backs off while the queue cannot be read, and resumes the normal pace once it can', async () => {
    startRun();
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      id: 'q1',
      length: 1,
      queued: true,
    });
    const list = vi
      .spyOn(aiAgentService, 'listQueuedFollowUps')
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue([pending('q1')]);
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));
    await handOffQueuedMessage(get, key, context, 'q1', async () => request);

    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS); // 1st read fails
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS * 2 - 1);
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // 2nd read after 3s, fails
    expect(list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS * 4); // 3rd after 6s, succeeds
    expect(list).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS); // back to 1.5s
    expect(list).toHaveBeenCalledTimes(4);
  });

  it('keeps the row and reports the failure when a withdrawal cannot reach the queue', async () => {
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'server', serverRequest: request }));
    vi.spyOn(aiAgentService, 'removeQueuedFollowUp').mockRejectedValue(
      Object.assign(new Error('Queue unavailable'), { data: { code: 'SERVICE_UNAVAILABLE' } }),
    );

    await expect(withdrawQueuedMessage(get, key, 'q1')).rejects.toThrow('Queue unavailable');
    expect(queue()).toEqual([expect.objectContaining({ id: 'q1', serverDelivery: 'server' })]);
  });

  it('keeps showing one it could not withdraw because a run is delivering it', async () => {
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'server', serverRequest: request }));
    vi.spyOn(aiAgentService, 'removeQueuedFollowUp').mockResolvedValue({
      removed: false,
      state: 'delivering',
    });

    await expect(withdrawQueuedMessage(get, key, 'q1')).resolves.toBe(false);
    expect(queue()).toEqual([expect.objectContaining({ id: 'q1', serverDelivery: 'server' })]);
  });

  it('stores the composer state with the follow-up, so a reload can resend it as typed', async () => {
    startRun();
    const editorData = { root: { type: 'root' } };
    const append = vi
      .spyOn(aiAgentService, 'appendQueuedFollowUp')
      .mockResolvedValue({ id: 'q1', length: 1, queued: true });
    get().enqueueMessage(key, queued('q1', { editorData, serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);

    expect(append).toHaveBeenCalledWith({
      composer: { editorData, filesPreview: undefined },
      id: 'q1',
      request,
    });
  });
});

describe('server queue watch after the run ended without taking them', () => {
  // ROOT CAUSE:
  //
  // A stopped (or failed) run starts nothing next, but the watch kept polling
  // the server queue every 1.5s for as long as the page stayed open, and the
  // follow-ups stayed on the server, waiting to join whatever run came next.
  //
  // Before: the follow-ups never came back to this client.
  // After: with no run here and nothing taken, they come back after a while.
  it('takes the follow-ups back and stops polling', async () => {
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      id: 'q1',
      length: 1,
      queued: true,
    });
    const list = vi
      .spyOn(aiAgentService, 'listQueuedFollowUps')
      .mockResolvedValue([pending('q1', { createdAt: 1, prompt: 'q1' })]);
    const remove = vi
      .spyOn(aiAgentService, 'removeQueuedFollowUp')
      .mockResolvedValue({ removed: true, state: 'removed' });
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS * 25);

    expect(remove).toHaveBeenCalledWith({ id: 'q1', threadId: null, topicId: 'tpc-1' });
    expect(queue()).toEqual([expect.objectContaining({ id: 'q1' })]);
    expect(queue()[0].serverDelivery).toBeUndefined();
    const polls = list.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS * 5);
    expect(list).toHaveBeenCalledTimes(polls);
  });

  it('takes them back at once when the run was stopped elsewhere', async () => {
    const { operationId } = startRun();
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      id: 'q1',
      length: 1,
      queued: true,
    });
    vi.spyOn(aiAgentService, 'listQueuedFollowUps').mockResolvedValue([
      pending('q1', { createdAt: 1, prompt: 'q1' }),
    ]);
    const remove = vi
      .spyOn(aiAgentService, 'removeQueuedFollowUp')
      .mockResolvedValue({ removed: true, state: 'removed' });
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));
    await handOffQueuedMessage(get, key, context, 'q1', async () => request);

    // agent_runtime_end(interrupted) from a stop in another tab.
    get().completeOperation(operationId);
    get().updateOperationMetadata(operationId, { endedWithoutCompletion: true });
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS * 2);

    expect(remove).toHaveBeenCalledWith({ id: 'q1', threadId: null, topicId: 'tpc-1' });
    expect(queue()[0].serverDelivery).toBeUndefined();
  });

  it('keeps watching while the run is still going here', async () => {
    startRun();
    vi.spyOn(aiAgentService, 'appendQueuedFollowUp').mockResolvedValue({
      id: 'q1',
      length: 1,
      queued: true,
    });
    vi.spyOn(aiAgentService, 'listQueuedFollowUps').mockResolvedValue([
      pending('q1', { createdAt: 1, prompt: 'q1' }),
    ]);
    const remove = vi.spyOn(aiAgentService, 'removeQueuedFollowUp');
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'appending' }));

    await handOffQueuedMessage(get, key, context, 'q1', async () => request);
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS * 25);

    expect(remove).not.toHaveBeenCalled();
    expect(queue()[0].serverDelivery).toBe('server');
  });
});

describe('restoreServerQueuedMessages', () => {
  // ROOT CAUSE:
  //
  // The tray only lived in this page's memory. After a reload during a run the
  // follow-ups still waiting on the server were gone from the tray, nothing
  // followed them, and the run the server started for them never showed up on
  // the reloaded page until another reload.
  //
  // Before: nothing read the server queue back on reconnect.
  // After: they are back in the tray as the server's, and watched again.
  it('puts the follow-ups waiting on the server back in the tray and watches them', async () => {
    vi.spyOn(aiAgentService, 'listQueuedFollowUps')
      .mockResolvedValueOnce([pending('q1', { createdAt: 5, prompt: 'later' })])
      .mockResolvedValue([]);
    startRun();

    await restoreServerQueuedMessages(get, context);

    expect(queue()).toEqual([
      expect.objectContaining({ content: 'later', id: 'q1', serverDelivery: 'server' }),
    ]);
    // Never told to the run as a client-held message: the server joins it.
    expect(aiAgentService.setQueuedMessages).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS);
    expect(queue()).toHaveLength(0);
  });

  it('brings back the composer state and selections it was sent with', async () => {
    const editorData = { root: { type: 'root' } };
    vi.spyOn(aiAgentService, 'listQueuedFollowUps')
      .mockResolvedValueOnce([
        pending('q1', {
          editorData,
          mentionedAgents: [{ id: 'agt-2', name: 'B' }],
          selectedSkillIds: ['s1'],
          selectedToolIds: ['t1'],
        }),
      ])
      .mockResolvedValue([]);
    startRun();

    await restoreServerQueuedMessages(get, context);

    // A local resend (after a stop, or Send now) re-reads these from `editorData`.
    expect(queue()[0]).toMatchObject({
      editorData,
      serverRequest: {
        mentionedAgents: [{ id: 'agt-2', name: 'B' }],
        selectedSkillIds: ['s1'],
        selectedToolIds: ['t1'],
      },
    });
  });

  it('brings back attachment previews, so the tray shows them and Edit restores them', async () => {
    const filesPreview = [
      { id: 'f1', mimeType: 'image/png', name: 'a.png', url: 'https://x/a.png' },
    ];
    vi.spyOn(aiAgentService, 'listQueuedFollowUps')
      .mockResolvedValueOnce([pending('q1', { fileIds: ['f1'], filesPreview })])
      .mockResolvedValue([]);

    // Nothing runs: e.g. its next turn failed to start and it went back to wait.
    await restoreServerQueuedMessages(get, context);

    expect(queue()[0]).toMatchObject({ files: ['f1'], filesPreview, serverDelivery: 'server' });
  });

  it('retries reading the queue when the conversation opens during an outage', async () => {
    vi.spyOn(aiAgentService, 'listQueuedFollowUps')
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce([pending('q1', { prompt: 'later' })])
      .mockResolvedValue([]);

    const restoring = restoreServerQueuedMessages(get, context);
    await vi.advanceTimersByTimeAsync(SERVER_QUEUE_POLL_MS);
    await restoring;

    expect(queue()).toEqual([expect.objectContaining({ content: 'later', id: 'q1' })]);
  });

  // ROOT CAUSE:
  //
  // Restoring was skipped when Gateway mode was off, though entries accepted
  // while it was on stay up to a day: turning it off (or a rollout change) left
  // them invisible and impossible to withdraw, still able to run.
  //
  // Before: restore required Gateway mode to be on now.
  // After: it reads the owner's queue regardless.
  it('restores follow-ups accepted earlier even with Gateway mode now off', async () => {
    useChatStore.setState({ isGatewayModeEnabled: () => false });
    vi.spyOn(aiAgentService, 'listQueuedFollowUps')
      .mockResolvedValueOnce([pending('q1', { prompt: 'earlier' })])
      .mockResolvedValue([]);

    await restoreServerQueuedMessages(get, context);

    expect(queue()).toEqual([expect.objectContaining({ content: 'earlier', id: 'q1' })]);
  });

  it('adds nothing twice and stays out of threads', async () => {
    const list = vi
      .spyOn(aiAgentService, 'listQueuedFollowUps')
      .mockResolvedValue([pending('q1', { createdAt: 5, prompt: 'later' })]);
    get().enqueueMessage(key, queued('q1', { serverDelivery: 'server', serverRequest: request }));

    await restoreServerQueuedMessages(get, context);
    expect(queue()).toHaveLength(1);

    list.mockClear();
    await restoreServerQueuedMessages(get, { ...context, threadId: 'thd-1' });
    await restoreServerQueuedMessages(get, { ...context, documentId: 'doc-1', scope: 'page' });
    await restoreServerQueuedMessages(get, { ...context, groupId: 'grp-1' });
    expect(list).not.toHaveBeenCalled();
  });
});

describe('withdrawQueuedMessage / reclaimServerQueuedMessages', () => {
  const holdOnServer = (id: string) =>
    get().enqueueMessage(key, queued(id, { serverDelivery: 'server', serverRequest: request }));

  it('takes a follow-up back from the server before it is edited or sent now', async () => {
    holdOnServer('q1');
    vi.spyOn(aiAgentService, 'removeQueuedFollowUp').mockResolvedValue({
      removed: true,
      state: 'removed',
    });

    await expect(withdrawQueuedMessage(get, key, 'q1')).resolves.toBe(true);
    expect(queue()).toHaveLength(0);
  });

  it('reports a follow-up the server already took, so it is not sent twice', async () => {
    holdOnServer('q1');
    vi.spyOn(aiAgentService, 'removeQueuedFollowUp').mockResolvedValue({
      removed: false,
      state: 'taken',
    });

    await expect(withdrawQueuedMessage(get, key, 'q1')).resolves.toBe(false);
    expect(queue()).toHaveLength(0);
  });

  // ROOT CAUSE:
  //
  // Two tabs withdrawing the same confirmed follow-up: one got `removed`, the
  // other `absent`, and both counted it as theirs — so both could Edit or Send
  // now and run it twice.
  //
  // Before: `absent` meant "withdrawn" for any entry.
  // After: only `removed` does for a confirmed one; `absent` only for an
  // append that was never confirmed.
  it('does not take a confirmed follow-up another tab already withdrew', async () => {
    holdOnServer('q1');
    vi.spyOn(aiAgentService, 'removeQueuedFollowUp').mockResolvedValue({
      removed: false,
      state: 'absent',
    });

    await expect(withdrawQueuedMessage(get, key, 'q1')).resolves.toBe(false);
    expect(queue()).toHaveLength(0);
  });

  it('takes an unconfirmed follow-up the server never stored', async () => {
    get().enqueueMessage(
      key,
      queued('q1', { serverDelivery: 'server', serverRequest: request, serverUnconfirmed: true }),
    );
    vi.spyOn(aiAgentService, 'removeQueuedFollowUp').mockResolvedValue({
      removed: false,
      state: 'absent',
    });

    await expect(withdrawQueuedMessage(get, key, 'q1')).resolves.toBe(true);
  });

  it('after a stop, leaves one another tab already took back to that tab', async () => {
    holdOnServer('q1');
    vi.spyOn(aiAgentService, 'removeQueuedFollowUp').mockResolvedValue({
      removed: false,
      state: 'absent',
    });

    await reclaimServerQueuedMessages(get, key);

    expect(queue()).toHaveLength(0);
  });

  it('after a stop, keeps here what the server still had and drops what it took', async () => {
    holdOnServer('waiting');
    holdOnServer('taken');
    vi.spyOn(aiAgentService, 'removeQueuedFollowUp').mockImplementation(async ({ id }) =>
      id === 'waiting' ? { removed: true, state: 'removed' } : { removed: false, state: 'taken' },
    );

    await reclaimServerQueuedMessages(get, key);

    expect(queue()).toEqual([
      expect.objectContaining({ id: 'waiting', serverDelivery: undefined }),
    ]);
    expect(get().drainQueuedMessages(key)).toHaveLength(1);
  });
});
