// @vitest-environment node
import type { SchedulerEvent, SchedulerOptions, SchedulerState } from '../botWake/scheduler';
import { transitionScheduler } from '../botWake/scheduler';
import replay from './__fixtures__/botWakeSchedulerReplay.json';

interface RecordedStep {
  decision?: string;
  effects: unknown[];
  event: SchedulerEvent;
  state: SchedulerState;
}

/**
 * Replays a recorded sequence of scheduler events and checks every persisted state snapshot.
 * A change to the state machine that alters any recorded behaviour fails here, with the step.
 */
describe('wake scheduler replay', () => {
  it('reproduces the recorded decisions, effects and state snapshots', () => {
    let runCounter = 0;
    let state: SchedulerState | undefined;

    (replay.steps as RecordedStep[]).forEach((step, index) => {
      const next = transitionScheduler(
        state,
        step.event,
        replay.options as SchedulerOptions,
        () => `run-${++runCounter}`,
      );

      expect(
        { decision: next.decision, effects: next.effects, state: next.state },
        `step ${index}`,
      ).toEqual({
        decision: step.decision,
        effects: step.effects,
        state: step.state,
      });
      state = next.state;
    });
  });

  it('survives a JSON round trip between every step, as it does through Redis', () => {
    let runCounter = 0;
    let state: SchedulerState | undefined;

    for (const step of replay.steps as RecordedStep[]) {
      const next = transitionScheduler(
        state,
        step.event,
        replay.options as SchedulerOptions,
        () => `run-${++runCounter}`,
      );
      state = structuredClone(next.state);
    }

    expect(state).toEqual((replay.steps.at(-1) as RecordedStep).state);
  });
});
