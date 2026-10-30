import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicStartReservationError } from '../topicStartReservation';
import { runWithTopicStart, type TopicStartDeps } from './topicStart';

const fence = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }));
vi.mock('@/server/services/redis', () => ({ redisService: { threadStartFence: fence } }));

const onThread = (extra: Record<string, unknown> = {}) =>
  ({
    agentId: 'agt-1',
    appContext: { threadId: 'thd-1', topicId: 'tpc-1' },
    prompt: 'hi',
    ...extra,
  }) as any;

const queuedSuccessor = onThread({ interactiveStart: false, queuedSuccessor: true });
const composerSend = onThread({ interactiveStart: true });

const createDeps = (liveRuns: string[] = []) =>
  ({
    findOwnLiveRuns: vi.fn().mockResolvedValue(liveRuns),
    userId: 'user-1',
  }) as unknown as TopicStartDeps;

describe('runWithTopicStart — existing threads', () => {
  const run = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fence.acquire.mockResolvedValue('held');
    fence.release.mockResolvedValue(undefined);
    run.mockResolvedValue({ operationId: 'op-new' });
  });

  it('starts a queued follow-up inside the thread fence once no run is live there', async () => {
    const deps = createDeps();

    await expect(runWithTopicStart(deps, queuedSuccessor, run)).resolves.toEqual({
      operationId: 'op-new',
    });
    expect(deps.findOwnLiveRuns).toHaveBeenCalledWith({
      threadId: 'thd-1',
      topicId: 'tpc-1',
      userId: 'user-1',
    });
    expect(fence.release).toHaveBeenCalledWith('thd-1', expect.any(String));
  });

  it('refuses a queued follow-up when the user already started a run on the thread', async () => {
    await expect(
      runWithTopicStart(createDeps(['op-user']), queuedSuccessor, run),
    ).rejects.toBeInstanceOf(TopicStartReservationError);
    expect(run).not.toHaveBeenCalled();
    expect(fence.release).toHaveBeenCalled();
  });

  it.each(['busy', 'unavailable'] as const)(
    'refuses a queued follow-up when the fence is %s, never starting next to another start',
    async (state) => {
      fence.acquire.mockResolvedValue(state);

      await expect(runWithTopicStart(createDeps(), queuedSuccessor, run)).rejects.toBeInstanceOf(
        TopicStartReservationError,
      );
      expect(run).not.toHaveBeenCalled();
      expect(fence.release).not.toHaveBeenCalled();
    },
  );

  it('never refuses a person at the composer, even when the fence stays busy', async () => {
    fence.acquire.mockResolvedValue('busy');
    const deps = createDeps(['op-other']);

    await expect(runWithTopicStart(deps, composerSend, run)).resolves.toEqual({
      operationId: 'op-new',
    });
    expect(deps.findOwnLiveRuns).not.toHaveBeenCalled();
  });
});
