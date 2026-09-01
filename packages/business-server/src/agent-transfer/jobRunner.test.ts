// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Controller = { reject: (error: Error) => void; resolve: () => void };

/** One controller per in-flight drain, FIFO per job id. */
const controllers = new Map<string, Controller[]>();
const started: string[] = [];

vi.mock('@lobechat/database', () => ({
  AgentTransferJobModel: {},
  drainAgentHistoryJob: (_db: unknown, jobId: string) => {
    started.push(jobId);
    return new Promise<void>((resolve, reject) => {
      const list = controllers.get(jobId) ?? [];
      list.push({ reject, resolve });
      controllers.set(jobId, list);
    });
  },
}));

const db = {} as never;

/** Fresh module per test — the runner keeps its queue in module state. */
const loadRunner = async () => {
  vi.resetModules();
  return import('./jobRunner');
};

const settle = async (jobId: string, outcome: 'ok' | 'fail') => {
  const controller = controllers.get(jobId)?.shift();
  if (!controller) throw new Error(`no active drain for ${jobId}`);
  if (outcome === 'ok') controller.resolve();
  else controller.reject(new Error('boom'));
  // Flush the runner's continuation without advancing the retry delay.
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  controllers.clear();
  started.length = 0;
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startAgentTransferJob scheduling', () => {
  it('caps concurrent drains and starts queued jobs as slots free up', async () => {
    const { startAgentTransferJob } = await loadRunner();

    for (const id of ['j1', 'j2', 'j3', 'j4', 'j5']) startAgentTransferJob(db, id);
    // Only the cap's worth of drains actually run; the rest wait in FIFO.
    expect(started).toEqual(['j1', 'j2', 'j3']);

    await settle('j1', 'ok');
    expect(started).toEqual(['j1', 'j2', 'j3', 'j4']);

    await settle('j2', 'ok');
    expect(started).toEqual(['j1', 'j2', 'j3', 'j4', 'j5']);
  });

  it('deduplicates repeated starts for active AND queued jobs', async () => {
    const { startAgentTransferJob } = await loadRunner();

    for (const id of ['j1', 'j2', 'j3', 'queued']) startAgentTransferJob(db, id);
    // Re-starting an actively draining job and a still-queued one must both no-op.
    startAgentTransferJob(db, 'j1');
    startAgentTransferJob(db, 'queued');

    await settle('j1', 'ok');
    await settle('j2', 'ok');
    await settle('j3', 'ok');
    await settle('queued', 'ok');
    expect(started).toEqual(['j1', 'j2', 'j3', 'queued']);
  });

  it('promotes a queued job to the front when a user prioritizes it', async () => {
    const { startAgentTransferJob } = await loadRunner();

    for (const id of ['j1', 'j2', 'j3', 'q1', 'q2']) startAgentTransferJob(db, id);
    expect(started).toEqual(['j1', 'j2', 'j3']);

    // A user opened a topic of q2 — it must jump ahead of q1, and the
    // duplicate suppression must still hold (one drain, not two).
    startAgentTransferJob(db, 'q2', { promote: true });

    await settle('j1', 'ok');
    expect(started).toEqual(['j1', 'j2', 'j3', 'q2']);

    await settle('j2', 'ok');
    expect(started).toEqual(['j1', 'j2', 'j3', 'q2', 'q1']);

    await settle('j3', 'ok');
    await settle('q1', 'ok');
    await settle('q2', 'ok');
  });

  it('releases a failing drain’s slot immediately and requeues it after the delay', async () => {
    const { startAgentTransferJob } = await loadRunner();

    for (const id of ['a', 'b', 'c', 'd']) startAgentTransferJob(db, id);
    expect(started).toEqual(['a', 'b', 'c']);

    // The failure frees the slot at once — 'd' starts without waiting for the
    // retry delay, so persistent failures can never pin every slot.
    await settle('a', 'fail');
    expect(started).toEqual(['a', 'b', 'c', 'd']);

    // While the failed job waits out its delay it stays deduped.
    startAgentTransferJob(db, 'a');
    await vi.advanceTimersByTimeAsync(5000);
    // Requeued behind a full house: it must wait for a slot, not preempt one.
    expect(started.filter((id) => id === 'a')).toHaveLength(1);

    await settle('b', 'ok');
    expect(started.filter((id) => id === 'a')).toHaveLength(2);

    await settle('a', 'ok');
    await settle('c', 'ok');
    await settle('d', 'ok');
    expect(started).toEqual(['a', 'b', 'c', 'd', 'a']);
  });
});
