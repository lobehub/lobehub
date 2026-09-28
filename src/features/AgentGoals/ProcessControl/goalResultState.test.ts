import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import type { GoalGraphView, GoalNodeView } from './goalGraphViewModel';
import { buildResultTrail, findFinalAcceptanceView, hasGoalResult } from './goalResultState';

const node = (
  status: string,
  { acceptance = true, title = GOAL_ACCEPTANCE_TASK_TITLE } = {},
): GoalNodeView =>
  ({
    acceptance: acceptance ? { id: 'acc-1', status: 'delivered' } : undefined,
    node: { id: `n-${status}-${title}`, kind: 'task', status, title },
  }) as unknown as GoalNodeView;

const graph = (goalStatus: string, nodes: GoalNodeView[]) =>
  ({ goal: { status: goalStatus }, nodes }) as unknown as Pick<GoalGraphView, 'goal' | 'nodes'>;

describe('hasGoalResult', () => {
  /**
   * Regression: a finished Goal wrapped its delivery inside the 当前任务 section
   * of the process view. The result gets its own tab once the Goal is done.
   */
  it('offers a result once the final acceptance task resolved', () => {
    expect(hasGoalResult(graph('review', [node('resolved')]))).toBe(true);
  });

  it('offers a result for an achieved Goal without a final acceptance task', () => {
    expect(hasGoalResult(graph('achieved', []))).toBe(true);
  });

  it('keeps a running Goal on the process view', () => {
    expect(hasGoalResult(graph('running', [node('active')]))).toBe(false);
    expect(hasGoalResult(graph('running', [node('resolved', { acceptance: false })]))).toBe(false);
    expect(hasGoalResult(graph('running', [node('resolved', { title: 'Other task' })]))).toBe(
      false,
    );
  });
});

describe('findFinalAcceptanceView', () => {
  it('picks the resolved final acceptance task', () => {
    const accepted = node('resolved');
    expect(findFinalAcceptanceView({ nodes: [node('active'), accepted] })).toBe(accepted);
  });
});

describe('buildResultTrail', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 28, 0, minutes));
  const view = (id: string, kind: string, minutes: number, producedBy?: string) =>
    ({
      node: { createdAt: at(minutes), id, kind, resolvedAt: at(minutes), title: id },
      producedBy: producedBy ? { id: producedBy } : undefined,
    }) as unknown as GoalNodeView;
  const artifact = (id: string, nodeId: string, minutes: number) =>
    ({ createdAt: at(minutes), nodeId, workVersionId: id }) as any;

  /**
   * Regression: the result tab listed 交付物 and 结论 as two unrelated lists,
   * leaving no path from a conclusion to the files behind it. Each step now
   * carries both, joined on the task that produced them.
   */
  it('joins conclusions and deliverables on the task that produced them, in order', () => {
    const taskA = view('task-a', 'task', 10);
    const taskB = view('task-b', 'task', 5);
    const idle = view('task-idle', 'task', 1);
    const findingA = view('finding-a', 'finding', 11, 'task-a');
    const findingB = view('finding-b', 'finding', 6, 'task-b');
    const orphan = view('finding-orphan', 'finding', 20);

    const trail = buildResultTrail({
      artifacts: [artifact('v-a', 'task-a', 12), artifact('v-b', 'task-b', 7)],
      byId: { 'task-a': taskA, 'task-b': taskB, 'task-idle': idle },
      findings: [findingA, orphan, findingB],
    });

    expect(trail.map((step) => step.key)).toEqual(['task-b', 'task-a', 'unattributed']);
    expect(trail[0].findings).toEqual([findingB]);
    expect(trail[0].artifacts.map((a) => a.workVersionId)).toEqual(['v-b']);
    expect(trail[1].findings).toEqual([findingA]);
    expect(trail[2].findings).toEqual([orphan]);
    expect(trail[2].view).toBeUndefined();
  });
});
