import type { GoalNodeStatus } from '@lobechat/types';

import type { OperationGoal } from '@/features/Conversation/Messages/GoalTaskCard/deriveOperationGoals';

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
  nodes: { id: string; status: GoalNodeStatus; title: string }[],
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

/** Row states as graph node statuses, fed to the step track's segmentation. */
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

export type GoalStepState = 'active' | 'done' | 'pending';

const toGoalStepState = (status: GoalNodeStatus): GoalStepState => {
  if (CLOSED_STEP_STATUSES.has(status)) return 'done';
  if (status === 'active') return 'active';
  return 'pending';
};

/** A step track can show at most this many segments before they stop reading as steps. */
export const MAX_GOAL_STEP_SEGMENTS = 12;

/**
 * One track segment per Task so the card reads as a plan of steps instead of one
 * anonymous bar. Graphs longer than the segment cap are sliced evenly; a slice
 * keeps the least advanced state it contains (pending < active < done), so the
 * fill still advances left to right and never overstates progress.
 */
export const buildGoalStepSegments = (statuses: GoalNodeStatus[]): GoalStepState[] => {
  const states = statuses.map(toGoalStepState);
  if (states.length <= MAX_GOAL_STEP_SEGMENTS) return states;

  const perSegment = Math.ceil(states.length / MAX_GOAL_STEP_SEGMENTS);
  const segments: GoalStepState[] = [];
  for (let start = 0; start < states.length; start += perSegment) {
    const slice = states.slice(start, start + perSegment);
    segments.push(
      slice.includes('pending') ? 'pending' : slice.includes('active') ? 'active' : 'done',
    );
  }
  return segments;
};

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
 * position and richer metadata; persisted-only goals follow, deduped by id,
 * as `command` goals — only a CLI agent's shell call leaves a goal without a
 * derivable tool result.
 */
export const mergeTopicGoals = (
  derived: OperationGoal[],
  persisted: { goal: { id: string; title?: string | null } }[] = [],
): OperationGoal[] => {
  const seen = new Set(derived.map((goal) => goal.goalId));
  const linked = persisted.flatMap(({ goal }) => {
    if (seen.has(goal.id)) return [];
    seen.add(goal.id);
    return [
      {
        criteriaCount: 0,
        goalId: goal.id,
        name: goal.title?.trim() || goal.id,
        source: 'command' as const,
      },
    ];
  });

  return [...derived, ...linked];
};
