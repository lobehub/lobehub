import { beforeEach, describe, expect, it, vi } from 'vitest';

import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { messageService } from '@/services/message';
import type { QueuedMessage } from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';

import { createLocalSteer, startLocalSteer, supportsLocalSteer } from './localSteer';

vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: { steerSession: vi.fn() },
}));
vi.mock('@/services/message', () => ({ messageService: { createMessage: vi.fn() } }));
const mode = vi.hoisted(() => ({ value: 'steer' as 'queue' | 'steer' }));
vi.mock('../../lifecycle/followUpMode', () => ({ getFollowUpMode: () => mode.value }));

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

/** A store with just the queue and the calls the steer makes, notifying on queue changes. */
const createHarness = (messages: QueuedMessage[], waiting = false, ready = { value: true }) => {
  let queue = [...messages];
  const listeners = new Set<() => void>();
  const setQueue = (next: QueuedMessage[]) => {
    queue = next;
    for (const listener of listeners) listener();
  };
  const store = {
    drainQueuedMessages: vi.fn((_key: string, options?: { limit?: number }) => {
      const taken = queue.slice(0, options?.limit ?? queue.length);
      setQueue(queue.slice(taken.length));
      return taken;
    }),
    internal_confirmClientMessages: vi.fn(),
    internal_dispatchMessage: vi.fn(),
    get queuedMessages() {
      return { key: queue };
    },
    removeQueuedMessage: vi.fn((_key: string, id: string) =>
      setQueue(queue.filter((m) => m.id !== id)),
    ),
    requeueQueuedMessages: vi.fn((_key: string, back: QueuedMessage[]) =>
      setQueue([...back, ...queue]),
    ),
    updateOperationMetadata: vi.fn(),
    updateQueuedMessage: vi.fn((_key: string, id: string, patch: Partial<QueuedMessage>) =>
      setQueue(queue.map((m) => (m.id === id ? { ...m, ...patch } : m))),
    ),
  } as unknown as ChatStore;
  let spine = 'assistant-1';
  const rows = { add: vi.fn(), ensureParentPersisted: vi.fn(async () => {}) };
  const steer = createLocalSteer({
    context: { agentId: 'agent-1', threadId: null, topicId: 'topic-1' },
    contextKey: 'key',
    get: () => store,
    ipcSessionId: 'ipc-1',
    isReady: () => ready.value,
    isWaitingForUser: () => waiting,
    operationId: 'op-1',
    rows,
    spine: { get: () => spine, set: (id) => (spine = id) },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return { getQueue: () => queue, getSpine: () => spine, rows, setQueue, steer, store };
};

const steerCall = () => vi.mocked(heterogeneousAgentService.steerSession).mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  mode.value = 'steer';
  vi.mocked(heterogeneousAgentService.steerSession).mockResolvedValue({ status: 'accepted' });
  vi.mocked(messageService.createMessage).mockResolvedValue({ id: 'x' } as any);
});

describe('supportsLocalSteer', () => {
  it.each([
    ['claude-code', {}, true],
    ['pi', {}, true],
    ['codex', { codexAppServer: true }, true],
    ['codex', {}, false],
    ['copilot', {}, false],
    ['amp', {}, false],
  ])('%s %o → %s', (agentType, options, expected) => {
    expect(supportsLocalSteer(agentType, options)).toBe(expected);
  });
});

describe('createLocalSteer', () => {
  it('merges what waits into one message, shows it as being handed over, and writes it once read', async () => {
    const h = createHarness([
      queued('q1', 'first'),
      queued('q2', 'second'),
      queued('q3', 'file', { files: ['f'] }),
    ]);
    await vi.waitFor(() => expect(heterogeneousAgentService.steerSession).toHaveBeenCalled());

    const { messageId } = steerCall()!;
    expect(steerCall()).toMatchObject({ prompt: 'first\n\nsecond', sessionId: 'ipc-1' });
    expect(h.getQueue().map((m) => [m.id, m.localSteer])).toEqual([
      [messageId, 'delivering'],
      ['q3', undefined],
    ]);

    await expect(h.steer.confirm({ uuid: messageId })).resolves.toBe(true);

    expect(messageService.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'first\n\nsecond',
        id: messageId,
        metadata: { steer: true },
        parentId: 'assistant-1',
        role: 'user',
      }),
    );
    // The answer opens under the steer message.
    expect(h.getSpine()).toBe(messageId);
    expect(h.getQueue().map((m) => m.id)).toEqual(['q3']);
  });

  it('takes a confirmation that arrives before the write is answered', async () => {
    let answer!: (value: { status: 'accepted' }) => void;
    vi.mocked(heterogeneousAgentService.steerSession).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const h = createHarness([queued('q1', 'first')]);
    await vi.waitFor(() => expect(heterogeneousAgentService.steerSession).toHaveBeenCalled());

    await expect(h.steer.confirm({ uuid: steerCall()!.messageId })).resolves.toBe(true);
    answer({ status: 'accepted' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.steer.settle();

    expect(messageService.createMessage).toHaveBeenCalledTimes(1);
    // Read, so nothing goes back for the next turn.
    expect(h.getQueue()).toEqual([]);
  });

  it('writes the steer message only once its parent row is persisted', async () => {
    const h = createHarness([queued('q1', 'first')]);
    await vi.waitFor(() => expect(heterogeneousAgentService.steerSession).toHaveBeenCalled());
    const order: string[] = [];
    h.rows.ensureParentPersisted.mockImplementation(async () => void order.push('parent'));
    vi.mocked(messageService.createMessage).mockImplementation(async () => {
      order.push('steer');
      return { id: 'x' } as any;
    });

    await h.steer.confirm({ uuid: steerCall()!.messageId });

    expect(h.rows.ensureParentPersisted).toHaveBeenCalledWith('assistant-1');
    expect(order).toEqual(['parent', 'steer']);
  });

  it('parks a failed steer write for the run’s in-order replay', async () => {
    vi.mocked(messageService.createMessage).mockRejectedValue(new Error('fk'));
    const h = createHarness([queued('q1', 'first')]);
    await vi.waitFor(() => expect(heterogeneousAgentService.steerSession).toHaveBeenCalled());
    const { messageId } = steerCall()!;

    await h.steer.confirm({ uuid: messageId });

    expect(h.rows.add).toHaveBeenCalledWith(messageId, expect.objectContaining({ id: messageId }));
    expect(h.getSpine()).toBe(messageId);
  });

  it('matches Pi’s report against the text it actually received', async () => {
    vi.mocked(heterogeneousAgentService.steerSession).mockResolvedValue({
      deliveredText: 'Referenced topic guidance\n\nsee <refer_topic id="t"/>',
      status: 'accepted',
    });
    const h = createHarness([queued('q1', 'see <refer_topic id="t"/>')]);
    await vi.waitFor(() => expect(h.getQueue()[0]?.localSteer).toBe('delivering'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(h.steer.confirm({ text: 'see <refer_topic id="t"/>' })).resolves.toBe(false);
    await expect(
      h.steer.confirm({ text: 'Referenced topic guidance\n\nsee <refer_topic id="t"/>' }),
    ).resolves.toBe(true);
  });

  it('does not retry a refused steer, nor steer later messages ahead of it', async () => {
    vi.mocked(heterogeneousAgentService.steerSession).mockResolvedValue({ status: 'rejected' });
    const h = createHarness([queued('q1', 'first')]);
    await vi.waitFor(() => expect(h.getQueue().map((m) => m.id)).toEqual(['q1']));
    h.setQueue([...h.getQueue(), queued('q2', 'second')]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(heterogeneousAgentService.steerSession).toHaveBeenCalledTimes(1);
    expect(h.getQueue().map((m) => m.id)).toEqual(['q1', 'q2']);
  });

  it('ignores a replay that is not its steer (the run’s own prompt)', async () => {
    const h = createHarness([queued('q1', 'first')]);
    await vi.waitFor(() => expect(heterogeneousAgentService.steerSession).toHaveBeenCalled());

    await expect(h.steer.confirm({ uuid: 'other' })).resolves.toBe(false);
    expect(messageService.createMessage).not.toHaveBeenCalled();
  });

  it('matches by text for an agent that reports no id (Pi)', async () => {
    const h = createHarness([queued('q1', 'run the tests')]);
    await vi.waitFor(() => expect(heterogeneousAgentService.steerSession).toHaveBeenCalled());

    await expect(h.steer.confirm({ text: 'run the tests' })).resolves.toBe(true);
    expect(h.getQueue()).toEqual([]);
  });

  it('gives the messages back, unmerged, when the session refuses', async () => {
    vi.mocked(heterogeneousAgentService.steerSession).mockResolvedValue({ status: 'rejected' });
    const h = createHarness([queued('q1', 'first'), queued('q2', 'second')]);

    await vi.waitFor(() => expect(h.getQueue().map((m) => m.id)).toEqual(['q1', 'q2']));
    expect(h.store.updateOperationMetadata).not.toHaveBeenCalled();
  });

  it('marks a run with no native steer, so the tray says its queue waits for the end', async () => {
    vi.mocked(heterogeneousAgentService.steerSession).mockResolvedValue({ status: 'unsupported' });
    const h = createHarness([queued('q1', 'first')]);

    await vi.waitFor(() =>
      expect(h.store.updateOperationMetadata).toHaveBeenCalledWith('op-1', {
        liveSteer: false,
        steerUnsupported: true,
      }),
    );
    expect(h.getQueue().map((m) => m.id)).toEqual(['q1']);
  });

  it('never resends a steer whose delivery is unknown', async () => {
    vi.mocked(heterogeneousAgentService.steerSession).mockRejectedValue(new Error('ipc lost'));
    const h = createHarness([queued('q1', 'first')]);

    await vi.waitFor(() => expect(h.getQueue()[0]?.localSteer).toBe('unknown'));
    h.setQueue([...h.getQueue(), queued('q9', 'later')]);
    expect(heterogeneousAgentService.steerSession).toHaveBeenCalledTimes(1);

    // The agent can still report it read; then it is written in after all.
    const { messageId } = steerCall()!;
    await expect(h.steer.confirm({ uuid: messageId })).resolves.toBe(true);
    expect(messageService.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: messageId, metadata: { steer: true } }),
    );
    expect(h.getQueue().map((m) => m.id)).toEqual(['q9']);
  });

  it('turns a steer written but never read into the next turn when the run ends', async () => {
    const h = createHarness([queued('q1', 'first'), queued('q2', 'second')]);
    await vi.waitFor(() => expect(heterogeneousAgentService.steerSession).toHaveBeenCalled());
    await vi.waitFor(() => expect(h.getQueue()[0]?.localSteer).toBe('delivering'));

    h.steer.settle();

    expect(h.getQueue().map((m) => m.id)).toEqual(['q1', 'q2']);
  });

  it('waits for the runtime to come up instead of taking a refusal for good', async () => {
    vi.useFakeTimers();
    const ready = { value: false };
    createHarness([queued('q1', 'first')], false, ready);
    await vi.advanceTimersByTimeAsync(1000);
    expect(heterogeneousAgentService.steerSession).not.toHaveBeenCalled();

    ready.value = true;
    await vi.advanceTimersByTimeAsync(600);
    expect(heterogeneousAgentService.steerSession).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('leaves new messages for the run end once the user switches to Queue', async () => {
    const h = createHarness([]);
    mode.value = 'queue';
    h.setQueue([queued('q1', 'first')]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(heterogeneousAgentService.steerSession).not.toHaveBeenCalled();
    expect(h.getQueue().map((m) => m.id)).toEqual(['q1']);
  });

  it('marks a steer still being written when the run ends as uncertain, never resent', async () => {
    let answer!: (value: { status: 'accepted' | 'rejected' }) => void;
    vi.mocked(heterogeneousAgentService.steerSession).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const h = createHarness([queued('q1', 'first')]);
    await vi.waitFor(() => expect(h.getQueue()[0]?.localSteer).toBe('delivering'));

    h.steer.settle();
    expect(h.getQueue()[0]?.localSteer).toBe('unknown');

    answer({ status: 'accepted' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.getQueue().map((m) => m.localSteer)).toEqual(['unknown']);
  });

  it('gives back a steer refused after the run ended', async () => {
    let answer!: (value: { status: 'accepted' | 'rejected' }) => void;
    vi.mocked(heterogeneousAgentService.steerSession).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const h = createHarness([queued('q1', 'first')]);
    await vi.waitFor(() => expect(h.getQueue()[0]?.localSteer).toBe('delivering'));

    h.steer.settle();
    answer({ status: 'rejected' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.getQueue().map((m) => [m.id, m.localSteer])).toEqual([['q1', undefined]]);
  });

  it('steers nothing while the run waits for the user', async () => {
    createHarness([queued('q1', 'first')], true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(heterogeneousAgentService.steerSession).not.toHaveBeenCalled();
  });
});

describe('startLocalSteer', () => {
  const start = (agentType: string) =>
    startLocalSteer({
      agentType,
      codexAppServer: true,
      context: { agentId: 'agent-1', threadId: null, topicId: 'topic-1' },
      contextKey: 'key',
      get: () => ({ queuedMessages: {}, updateOperationMetadata: vi.fn() }) as unknown as ChatStore,
      ipcSessionId: 'ipc-1',
      isReady: () => true,
      isWaitingForUser: () => false,
      operationId: 'op-1',
      rows: { add: vi.fn(), ensureParentPersisted: vi.fn(async () => {}) },
      spine: { get: () => 'a', set: vi.fn() },
    });

  it('sets up steering for Codex app-server and Pi in Queue mode, so a switch to Steer applies mid-run', () => {
    mode.value = 'queue';
    const codex = start('codex');
    const pi = start('pi');

    expect(codex).toBeDefined();
    expect(pi).toBeDefined();
    codex?.settle();
    pi?.settle();
  });

  it('leaves a Claude Code run started in Queue mode queued: it was not spawned to take messages', () => {
    mode.value = 'queue';
    expect(start('claude-code')).toBeUndefined();

    mode.value = 'steer';
    const cc = start('claude-code');
    expect(cc).toBeDefined();
    cc?.settle();
  });
});
