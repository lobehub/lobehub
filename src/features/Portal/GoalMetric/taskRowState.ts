import {
  type GoalNodeView,
  isRunningNode,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';

/**
 * What one All-tasks row says about its Task. The glyph, its hover label and
 * whether the duration clock ticks all read this one value, so the icon, the
 * word and the clock can never disagree — an `active` node that lost its lease
 * is `lost`, not "Running".
 */
export type TaskRowState = 'decision' | 'done' | 'lost' | 'queued' | 'retired' | 'running';

export const taskRowState = (view: GoalNodeView): TaskRowState => {
  if (view.isStale) return 'lost';
  if (view.decision) return 'decision';
  if (isRunningNode(view)) return 'running';
  if (view.node.status === 'resolved') return 'done';
  if (view.node.status === 'rejected' || view.node.status === 'retired') return 'retired';
  return 'queued';
};

export const taskRowStateLabelKey = (view: GoalNodeView, state: TaskRowState) => {
  if (state === 'lost') return 'goalProcess.tag.lost' as const;
  if (state === 'decision') return 'goalProcess.tag.needsDecision' as const;
  return `goalProcess.nodeStatus.${view.node.status}` as const;
};

export interface TaskRowSpan {
  /** Absent only while the Task is genuinely running — the clock is live. */
  endedAt?: Date;
  startedAt: Date;
}

/**
 * First attempt start → last attempt end. An attempt left open without a
 * running Task (lease lost, parked on a decision) has no audit boundary yet, so
 * it is closed at the last sign of life instead of ticking forever.
 */
export const taskRowSpan = (
  view: GoalNodeView,
  state: TaskRowState = taskRowState(view),
): TaskRowSpan | undefined => {
  const first = view.attempts[0];
  const last = view.attempts.at(-1);
  if (!first || !last) return undefined;

  const endedAt = last.endedAt ?? (state === 'running' ? undefined : view.heartbeatAt);
  return { endedAt, startedAt: first.startedAt };
};
