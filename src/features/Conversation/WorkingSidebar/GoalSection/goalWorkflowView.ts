import type { GoalNodeStatus } from '@lobechat/types';

import type { OperationGoal } from '@/features/Conversation/Messages/GoalTaskCard/deriveOperationGoals';
import type { GoalStep } from '@/features/Conversation/Messages/GoalTaskCard/goalTaskProgress';

export type GoalWorkflowRowState = 'done' | 'running' | 'waiting' | 'pending';

export interface GoalWorkflowRow {
  assigneeId?: string;
  id: string;
  state: GoalWorkflowRowState;
  title: string;
}

const CLOSED_STEP_STATUSES = new Set(['rejected', 'resolved', 'retired']);

/** Task nodes as display rows: closed steps read as done, `active` as running. */
export const buildWorkflowRows = (
  nodes: { id: string; status: GoalStep['status']; title: string }[],
  assignees?: Record<string, string>,
): GoalWorkflowRow[] =>
  nodes.map((node) => ({
    assigneeId: assignees?.[node.id],
    id: node.id,
    state: CLOSED_STEP_STATUSES.has(node.status)
      ? 'done'
      : node.status === 'active'
        ? 'running'
        : node.status === 'waiting'
          ? 'waiting'
          : 'pending',
    title: node.title,
  }));

/** Row states as graph node statuses, so the step track can reuse the
 * message card's segmentation (cap + conservative slicing) unchanged. */
export const toSegmentStatuses = (rows: GoalWorkflowRow[]): GoalNodeStatus[] =>
  rows.map((row) =>
    row.state === 'done'
      ? 'resolved'
      : row.state === 'running'
        ? 'active'
        : row.state === 'waiting'
          ? 'waiting'
          : 'proposed',
  );

export interface GoalWorkflowSummary {
  done: number;
  running: number;
  total: number;
}

export const summarizeWorkflow = (rows: GoalWorkflowRow[]): GoalWorkflowSummary => ({
  done: rows.filter((row) => row.state === 'done').length,
  running: rows.filter((row) => row.state === 'running').length,
  total: rows.length,
});

/** A chat sidebar keeps at most this many rows before folding into "N more". */
export const MAX_VISIBLE_WORKFLOW_ROWS = 4;

export const sliceVisibleWorkflowRows = (
  rows: GoalWorkflowRow[],
  expanded: boolean,
): GoalWorkflowRow[] => (expanded ? rows : rows.slice(0, MAX_VISIBLE_WORKFLOW_ROWS));

/**
 * Every goal the conversation created: the ones derived from its messages
 * (builtin `createGoal` results, `lh goal create` shell output) plus the goal
 * rows linked to the topic — a CLI agent's `lh goal create --conversation` can
 * leave no parseable tool result behind. Message-derived goals keep their
 * position and richer metadata; persisted-only goals follow, deduped by id.
 */
export const mergeTopicGoals = (
  derived: OperationGoal[],
  persisted: { goal: { id: string; title?: string | null } }[] = [],
): OperationGoal[] => {
  const seen = new Set(derived.map((goal) => goal.goalId));
  const linked = persisted.flatMap(({ goal }) => {
    if (seen.has(goal.id)) return [];
    seen.add(goal.id);
    return [{ criteriaCount: 0, goalId: goal.id, name: goal.title?.trim() || goal.id }];
  });

  return [...derived, ...linked];
};
