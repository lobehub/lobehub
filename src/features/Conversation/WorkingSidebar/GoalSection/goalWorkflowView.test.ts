import type { GoalNodeStatus } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  buildGoalStepSegments,
  buildWorkflowRows,
  MAX_VISIBLE_WORKFLOW_ROWS,
  mergeTopicGoals,
  sliceVisibleWorkflowRows,
  summarizeWorkflow,
  toSegmentStatuses,
} from './goalWorkflowView';

const step = (id: string, status: string, title = id) => ({
  id,
  status: status as GoalNodeStatus,
  title,
});

describe('mergeTopicGoals', () => {
  it('appends topic-linked goals that no message derived, deduped by id', () => {
    const merged = mergeTopicGoals(
      [{ criteriaCount: 2, goalId: 'goal-tool', name: 'From tool', source: 'tool' }],
      [
        { goal: { id: 'goal-tool', title: 'Persisted copy' } },
        { goal: { id: 'goal-cli', title: 'Created by lh' } },
        { goal: { id: 'goal-cli', title: 'Duplicate row' } },
      ],
    );

    expect(merged).toEqual([
      { criteriaCount: 2, goalId: 'goal-tool', name: 'From tool', source: 'tool' },
      { criteriaCount: 0, goalId: 'goal-cli', name: 'Created by lh', source: 'command' },
    ]);
  });

  it('returns the derived goals untouched when nothing is persisted yet', () => {
    const derived = [{ criteriaCount: 1, goalId: 'goal-a', name: 'A', source: 'tool' as const }];
    expect(mergeTopicGoals(derived, undefined)).toEqual(derived);
  });
});

describe('buildGoalStepSegments', () => {
  it('maps one segment per task in plan order', () => {
    expect(
      buildGoalStepSegments(['resolved', 'active', 'proposed', 'waiting', 'rejected']),
    ).toEqual(['done', 'active', 'pending', 'pending', 'done']);
  });

  it('retired tasks count as closed steps', () => {
    expect(buildGoalStepSegments(['retired', 'proposed'])).toEqual(['done', 'pending']);
  });

  it('slices graphs longer than the segment cap, keeping the least advanced state', () => {
    const statuses = Array.from({ length: 25 }, (_, index): GoalNodeStatus =>
      index < 12 ? 'resolved' : 'proposed',
    );

    // ceil(25 / 12) = 3 tasks per segment: indices 0–11 done, 12–24 pending.
    expect(buildGoalStepSegments(statuses)).toEqual([
      ...Array.from({ length: 4 }, () => 'done'),
      ...Array.from({ length: 5 }, () => 'pending'),
    ]);
  });
});

describe('buildWorkflowRows', () => {
  it('maps node statuses to row states and attaches assignees', () => {
    const rows = buildWorkflowRows(
      [
        step('a', 'resolved'),
        step('b', 'active'),
        step('c', 'waiting'),
        step('d', 'proposed'),
        step('e', 'rejected'),
      ],
      { b: 'agt-2' },
    );

    expect(rows.map((row) => row.state)).toEqual(['done', 'running', 'waiting', 'pending', 'done']);
    expect(rows[1].assigneeId).toBe('agt-2');
    expect(rows[0].assigneeId).toBeUndefined();
  });
});

describe('toSegmentStatuses', () => {
  it('maps row states to graph node statuses for the step track', () => {
    const rows = buildWorkflowRows([
      step('a', 'resolved'),
      step('b', 'active'),
      step('c', 'waiting'),
      step('d', 'proposed'),
    ]);

    expect(toSegmentStatuses(rows)).toEqual(['resolved', 'active', 'waiting', 'proposed']);
  });
});

describe('sliceVisibleWorkflowRows', () => {
  it('caps collapsed rows at the visible maximum', () => {
    const rows = buildWorkflowRows(Array.from({ length: 6 }, (_, i) => step(`t${i}`, 'proposed')));

    expect(sliceVisibleWorkflowRows(rows, false)).toHaveLength(MAX_VISIBLE_WORKFLOW_ROWS);
    expect(sliceVisibleWorkflowRows(rows, true)).toHaveLength(6);
  });
});

describe('summarizeWorkflow', () => {
  it('counts done and running rows for the header summary', () => {
    const rows = buildWorkflowRows([
      step('a', 'resolved'),
      step('b', 'active'),
      step('c', 'active'),
      step('d', 'proposed'),
    ]);

    expect(summarizeWorkflow(rows)).toEqual({ done: 1, running: 2, total: 4 });
  });
});
