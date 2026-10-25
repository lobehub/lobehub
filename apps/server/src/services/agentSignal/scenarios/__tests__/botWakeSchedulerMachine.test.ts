// @vitest-environment node
import type {
  SchedulerEffect,
  SchedulerEvent,
  SchedulerOptions,
  SchedulerState,
} from '../botWake/scheduler';
import { IDLE_STATE, MAX_PENDING_WAKES, transitionScheduler } from '../botWake/scheduler';

const OPTIONS: SchedulerOptions = { collectMs: 20_000, cooldownMs: 60_000, runLeaseMs: 300_000 };
const T0 = 1_000_000;

let runCounter = 0;
const newRunId = () => `run-${++runCounter}`;
beforeEach(() => {
  runCounter = 0;
});

const message = (at: number, id: string, threadId = 'th1'): SchedulerEvent => ({
  at,
  messageId: id,
  threadId,
  type: 'message',
});

/** Applies events in order; returns the final state and everything emitted along the way. */
const run = (events: SchedulerEvent[], start?: SchedulerState) => {
  let state = start;
  const decisions: (string | undefined)[] = [];
  const effects: SchedulerEffect[] = [];
  for (const event of events) {
    const step = transitionScheduler(state, event, OPTIONS, newRunId);
    state = step.state;
    decisions.push(step.decision);
    effects.push(...step.effects);
  }

  return { decisions, effects, state: state! };
};

describe('wake scheduler state machine', () => {
  it('starts idle and the first wake opens a collect window of at least 20s', () => {
    const { decisions, effects, state } = run([message(T0, 'm1')]);

    expect(decisions).toEqual(['hold']);
    expect(state).toMatchObject({ collectUntil: T0 + 20_000, phase: 'collecting' });
    expect(state.pending.map((wake) => wake.messageId)).toEqual(['m1']);
    expect(effects).toEqual([{ at: T0 + 20_000, type: 'scheduleFlush' }]);
  });

  it('collects later wakes into the same batch without extending the window', () => {
    const { decisions, effects, state } = run([
      message(T0, 'm1'),
      message(T0 + 5_000, 'm2'),
      message(T0 + 19_999, 'm3'),
    ]);

    expect(decisions).toEqual(['hold', 'hold', 'hold']);
    expect(state.collectUntil).toBe(T0 + 20_000);
    expect(state.pending).toHaveLength(3);
    expect(effects).toHaveLength(1);
  });

  it('does not run before the 20s window has elapsed', () => {
    const { effects, state } = run([message(T0, 'm1'), { at: T0 + 19_999, type: 'flush' }]);

    expect(state.phase).toBe('collecting');
    expect(effects.filter((effect) => effect.type === 'startRun')).toEqual([]);
    // An early flush books the real deadline again instead of dropping it.
    expect(effects.at(-1)).toEqual({ at: T0 + 20_000, type: 'scheduleFlush' });
  });

  it('runs the whole batch once the window elapses, one run per channel', () => {
    const { effects, state } = run([
      message(T0, 'm1', 'th1'),
      message(T0 + 1_000, 'm2', 'th2'),
      message(T0 + 2_000, 'm3', 'th1'),
      { at: T0 + 20_000, type: 'flush' },
    ]);

    expect(state).toMatchObject({ phase: 'running', pending: [], runId: 'run-1' });
    expect(state.released).toEqual(['m1', 'm2', 'm3']);
    const starts = effects.filter((effect) => effect.type === 'startRun');
    expect(starts).toEqual([
      {
        messageIds: ['m1', 'm2', 'm3'],
        runId: 'run-1',
        threadIds: ['th1', 'th2'],
        type: 'startRun',
      },
    ]);
    // The lease watchdog is booked with the run.
    expect(effects).toContainEqual({ at: T0 + 20_000 + 300_000, type: 'scheduleFlush' });
  });

  it('lets the released batch through when its messages are replayed', () => {
    const { decisions } = run([
      message(T0, 'm1'),
      { at: T0 + 20_000, type: 'flush' },
      message(T0 + 20_500, 'm1'),
    ]);

    expect(decisions.at(-1)).toBe('release');
  });

  it('holds a new wake while a run is in flight; there is never a second run', () => {
    const { decisions, effects, state } = run([
      message(T0, 'm1'),
      { at: T0 + 20_000, type: 'flush' },
      message(T0 + 30_000, 'm2'),
      { at: T0 + 40_000, type: 'flush' },
    ]);

    expect(decisions[2]).toBe('hold');
    expect(state).toMatchObject({ phase: 'running', runId: 'run-1' });
    expect(state.pending.map((wake) => wake.messageId)).toEqual(['m2']);
    expect(effects.filter((effect) => effect.type === 'startRun')).toHaveLength(1);
  });

  it('enters a cooldown of at least 60s when the run finishes', () => {
    const { effects, state } = run([
      message(T0, 'm1'),
      { at: T0 + 20_000, type: 'flush' },
      { at: T0 + 50_000, type: 'runDone' },
    ]);

    expect(state).toMatchObject({ cooldownUntil: T0 + 110_000, phase: 'cooldown', released: [] });
    expect(effects.at(-1)).toEqual({ at: T0 + 110_000, type: 'scheduleFlush' });
  });

  it('ignores a runDone for another run, or when nothing is running', () => {
    const base = run([message(T0, 'm1'), { at: T0 + 20_000, type: 'flush' }]).state;

    expect(
      run([{ at: T0 + 21_000, runId: 'someone-else', type: 'runDone' }], base).state.phase,
    ).toBe('running');
    expect(run([{ at: T0 + 1, type: 'runDone' }]).state.phase).toBe('idle');
  });

  it('goes back to idle after the cooldown when nothing is waiting', () => {
    const { state } = run([
      message(T0, 'm1'),
      { at: T0 + 20_000, type: 'flush' },
      { at: T0 + 50_000, type: 'runDone' },
      { at: T0 + 110_000, type: 'flush' },
    ]);

    expect(state).toEqual(IDLE_STATE);
  });

  it('collects wakes that arrive in the cooldown and runs them after it, not before', () => {
    const early = run([
      message(T0, 'm1'),
      { at: T0 + 20_000, type: 'flush' },
      { at: T0 + 50_000, type: 'runDone' },
      message(T0 + 70_000, 'm2'),
      { at: T0 + 109_999, type: 'flush' },
    ]);
    expect(early.state.phase).toBe('cooldown');
    expect(early.effects.filter((effect) => effect.type === 'startRun')).toHaveLength(1);

    const after = run([{ at: T0 + 110_000, type: 'flush' }], early.state);
    // m2 arrived at +70s; its 20s collect minimum ended at +90s, so it is due the moment
    // the cooldown ends.
    expect(after.state).toMatchObject({ phase: 'running', released: ['m2'] });
    expect(after.effects.find((effect) => effect.type === 'startRun')).toMatchObject({
      messageIds: ['m2'],
    });
  });

  it('gives a wake that lands right at the end of the cooldown its full collect window', () => {
    const { effects, state } = run([
      message(T0, 'm1'),
      { at: T0 + 20_000, type: 'flush' },
      { at: T0 + 50_000, type: 'runDone' },
      message(T0 + 109_000, 'm2'),
      { at: T0 + 110_000, type: 'flush' },
    ]);

    expect(state).toMatchObject({ collectUntil: T0 + 129_000, phase: 'collecting' });
    expect(effects.at(-1)).toEqual({ at: T0 + 129_000, type: 'scheduleFlush' });
  });

  it('frees a channel whose run never reports back once the lease lapses', () => {
    const { state } = run([
      message(T0, 'm1'),
      { at: T0 + 20_000, type: 'flush' },
      { at: T0 + 20_000 + 300_000, type: 'flush' },
    ]);

    expect(state.phase).toBe('cooldown');
    expect(state.cooldownUntil).toBe(T0 + 20_000 + 300_000 + 60_000);
  });

  it('treats a message after a dead run like any new wake', () => {
    const { decisions, state } = run([
      message(T0, 'm1'),
      { at: T0 + 20_000, type: 'flush' },
      message(T0 + 20_000 + 400_000, 'm9'),
    ]);

    expect(decisions.at(-1)).toBe('hold');
    expect(state.pending.map((wake) => wake.messageId)).toEqual(['m9']);
  });

  it('is idempotent for a redelivered message and a redelivered flush', () => {
    const once = run([message(T0, 'm1'), message(T0, 'm1')]);
    expect(once.state.pending).toHaveLength(1);

    const flushed = run([message(T0, 'm1'), { at: T0 + 20_000, type: 'flush' }]);
    const again = run([{ at: T0 + 20_001, type: 'flush' }], flushed.state);
    expect(again.state).toEqual(flushed.state);
    expect(again.effects.filter((effect) => effect.type === 'startRun')).toEqual([]);
  });

  it('bounds the parked batch', () => {
    const { state } = run(
      Array.from({ length: MAX_PENDING_WAKES + 5 }, (_, index) => message(T0 + index, `m${index}`)),
    );

    expect(state.pending).toHaveLength(MAX_PENDING_WAKES);
    expect(state.pending.at(-1)?.messageId).toBe(`m${MAX_PENDING_WAKES + 4}`);
  });

  it('does not mutate the state it was given', () => {
    const before = run([message(T0, 'm1')]).state;
    const snapshot = structuredClone(before);
    transitionScheduler(before, message(T0 + 1, 'm2'), OPTIONS, newRunId);

    expect(before).toEqual(snapshot);
  });
});
