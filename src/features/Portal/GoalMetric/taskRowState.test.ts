import { describe, expect, it } from 'vitest';

import type { GoalNodeView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';

import { taskRowSpan, taskRowState, taskRowStateLabelKey } from './taskRowState';

const STARTED = new Date('2026-09-26T10:00:00Z');
const HEARTBEAT = new Date('2026-09-26T10:20:00Z');
const ENDED = new Date('2026-09-26T10:40:00Z');

const view = (overrides: Partial<GoalNodeView> & { status?: string } = {}): GoalNodeView => {
  const { status = 'active', ...rest } = overrides;
  return {
    attempts: [{ index: 1, outcome: 'running', startedAt: STARTED }],
    heartbeatAt: HEARTBEAT,
    isStale: false,
    node: { kind: 'task', status },
    ...rest,
  } as unknown as GoalNodeView;
};

describe('taskRowState', () => {
  it('ticks the clock only for a task that is genuinely running', () => {
    const running = view();

    expect(taskRowState(running)).toBe('running');
    expect(taskRowStateLabelKey(running, 'running')).toBe('goalProcess.nodeStatus.active');
    expect(taskRowSpan(running)).toEqual({ endedAt: undefined, startedAt: STARTED });
  });

  it('reads a stale active task as lost and freezes its clock at the last heartbeat', () => {
    const stale = view({ isStale: true });
    const state = taskRowState(stale);

    expect(state).toBe('lost');
    // The node row still says `active`; the label must follow the lost glyph, not "Running".
    expect(taskRowStateLabelKey(stale, state)).toBe('goalProcess.tag.lost');
    expect(taskRowSpan(stale)).toEqual({ endedAt: HEARTBEAT, startedAt: STARTED });
  });

  it('freezes the clock of a task parked on a decision', () => {
    const parked = view({ decision: { id: 'd1' } as GoalNodeView['decision'] });
    const state = taskRowState(parked);

    expect(state).toBe('decision');
    expect(taskRowStateLabelKey(parked, state)).toBe('goalProcess.tag.needsDecision');
    expect(taskRowSpan(parked)?.endedAt).toEqual(HEARTBEAT);
  });

  it('spans a settled task from its first attempt start to its last attempt end', () => {
    const done = view({
      attempts: [
        { endedAt: HEARTBEAT, index: 1, outcome: 'failed', startedAt: STARTED },
        { endedAt: ENDED, index: 2, outcome: 'passed', startedAt: HEARTBEAT },
      ],
      status: 'resolved',
    });

    expect(taskRowState(done)).toBe('done');
    expect(taskRowSpan(done)).toEqual({ endedAt: ENDED, startedAt: STARTED });
  });

  it('has no span for a task that was never dispatched', () => {
    const queued = view({ attempts: [], status: 'proposed' });

    expect(taskRowState(queued)).toBe('queued');
    expect(taskRowSpan(queued)).toBeUndefined();
  });
});
