// @vitest-environment node
import type {
  SchedulerDelayQueue,
  SchedulerRunTarget,
  SchedulerState,
  SchedulerStore,
} from '../botWake/scheduler';
import { WakeScheduler } from '../botWake/scheduler';

/** In-memory store with the same contract as the Redis one: mutations are serialized per key. */
const createStore = () => {
  const states = new Map<string, string>();
  const tails = new Map<string, Promise<unknown>>();
  const store: SchedulerStore = {
    mutate: (key, mutate) => {
      const run = async () => {
        const stored = states.get(key);
        const { result, state } = mutate(
          stored ? (JSON.parse(stored) as SchedulerState) : undefined,
        );
        states.set(key, JSON.stringify(state));

        return result;
      };
      const next = (tails.get(key) ?? Promise.resolve()).then(run, run);
      tails.set(
        key,
        next.catch(() => {}),
      );

      return next as never;
    },
  };

  return { states, store };
};

const setup = (overrides: { store?: SchedulerStore } = {}) => {
  let now = 1_000_000;
  const memory = createStore();
  const flushes: { at: number; channelKey: string }[] = [];
  const runs: SchedulerRunTarget[] = [];
  const delayQueue: SchedulerDelayQueue = {
    scheduleFlush: vi.fn(async (input) => {
      flushes.push(input);
    }),
  };
  const scheduler = new WakeScheduler({
    delayQueue,
    now: () => now,
    options: { collectMs: 20_000, cooldownMs: 60_000 },
    startRun: vi.fn(async (target) => {
      runs.push(target);
    }),
    store: overrides.store ?? memory.store,
  });

  return {
    advance: (ms: number) => (now += ms),
    delayQueue,
    flushes,
    memory,
    runs,
    scheduler,
    time: () => now,
  };
};

describe('WakeScheduler', () => {
  it('books the delayed flush on the delay queue, not an in-process timer', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const { flushes, scheduler, time } = setup();

    await scheduler.submit({ channelKey: 'c1', messages: [{ id: 'm1', threadId: 't1' }] });

    expect(flushes).toEqual([{ at: time() + 20_000, channelKey: 'c1' }]);
    expect(timers).not.toHaveBeenCalled();
    timers.mockRestore();
  });

  it('holds wakes during the collect window and starts exactly one run after it', async () => {
    const { advance, flushes, runs, scheduler } = setup();

    expect(
      await scheduler.submit({ channelKey: 'c1', messages: [{ id: 'm1', threadId: 't1' }] }),
    ).toBe('hold');
    advance(5_000);
    expect(
      await scheduler.submit({ channelKey: 'c1', messages: [{ id: 'm2', threadId: 't1' }] }),
    ).toBe('hold');
    advance(10_000);
    await scheduler.flush('c1');
    expect(runs).toEqual([]);

    advance(5_000);
    await scheduler.flush('c1');
    await scheduler.flush('c1');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      channelKey: 'c1',
      messageIds: ['m1', 'm2'],
      threadIds: ['t1'],
    });
    expect(flushes.length).toBeGreaterThan(0);
  });

  it('releases the batch when it is replayed, and holds anything newer', async () => {
    const { advance, scheduler } = setup();
    await scheduler.submit({ channelKey: 'c1', messages: [{ id: 'm1', threadId: 't1' }] });
    advance(20_000);
    await scheduler.flush('c1');

    expect(
      await scheduler.submit({ channelKey: 'c1', messages: [{ id: 'm1', threadId: 't1' }] }),
    ).toBe('release');
    expect(
      await scheduler.submit({ channelKey: 'c1', messages: [{ id: 'm2', threadId: 't1' }] }),
    ).toBe('hold');
  });

  it('never has two runs in one channel, even for simultaneous wakes', async () => {
    const { advance, runs, scheduler } = setup();

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        scheduler.submit({ channelKey: 'c1', messages: [{ id: `m${index}`, threadId: 't1' }] }),
      ),
    );
    advance(20_000);
    await Promise.all([scheduler.flush('c1'), scheduler.flush('c1'), scheduler.flush('c1')]);

    expect(runs).toHaveLength(1);
    expect(runs[0].messageIds).toHaveLength(10);
  });

  it('keeps channels independent', async () => {
    const { advance, runs, scheduler } = setup();
    await scheduler.submit({ channelKey: 'c1', messages: [{ id: 'm1', threadId: 't1' }] });
    await scheduler.submit({ channelKey: 'c2', messages: [{ id: 'm1', threadId: 't2' }] });
    advance(20_000);
    await scheduler.flush('c1');
    await scheduler.flush('c2');

    expect(runs.map((run) => run.channelKey).sort()).toEqual(['c1', 'c2']);
  });

  it('runs the next batch only after the run is done and the 60s cooldown has passed', async () => {
    const { advance, runs, scheduler } = setup();
    await scheduler.submit({ channelKey: 'c1', messages: [{ id: 'm1', threadId: 't1' }] });
    advance(20_000);
    await scheduler.flush('c1');
    await scheduler.submit({ channelKey: 'c1', messages: [{ id: 'm2', threadId: 't1' }] });
    await scheduler.runDone('c1');

    advance(59_000);
    await scheduler.flush('c1');
    expect(runs).toHaveLength(1);

    advance(1_000);
    await scheduler.flush('c1');
    expect(runs).toHaveLength(2);
    expect(runs[1].messageIds).toEqual(['m2']);
  });

  it('reports `unavailable` when the state store cannot be reached, so the caller wakes as before', async () => {
    const { scheduler } = setup({ store: { mutate: async () => undefined } });

    expect(
      await scheduler.submit({ channelKey: 'c1', messages: [{ id: 'm1', threadId: 't1' }] }),
    ).toBe('unavailable');
  });

  it('survives a failing delay queue or run start: the state still advances', async () => {
    const { advance, delayQueue, memory, scheduler } = setup();
    vi.mocked(delayQueue.scheduleFlush).mockRejectedValue(new Error('qstash down'));

    await expect(
      scheduler.submit({ channelKey: 'c1', messages: [{ id: 'm1', threadId: 't1' }] }),
    ).resolves.toBe('hold');
    expect(JSON.parse(memory.states.get('c1')!)).toMatchObject({ phase: 'collecting' });
    advance(20_000);
    await expect(scheduler.flush('c1')).resolves.toBeUndefined();
  });
});
