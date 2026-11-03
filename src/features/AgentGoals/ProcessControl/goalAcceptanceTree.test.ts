import { GOAL_ACCEPTANCE_TASK_TITLE, GOAL_REPORT_TASK_TITLE } from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import { buildAcceptanceTree, hasAcceptanceTree } from './goalAcceptanceTree';
import type { GoalGraphView, GoalNodeView } from './goalGraphViewModel';
import { countGoalTasks } from './goalResultState';

const REPORT_NODE_ID = 'node-report';

const acceptanceNode = (
  id: string,
  status: string,
  {
    // `null` is the explicit "no acceptance"; the default fires only for
    // `undefined`, so it cannot be used to express it.
    acceptance = { id: `acc-${id}`, status } as GoalNodeView['acceptance'],
    title = id,
  }: { acceptance?: GoalNodeView['acceptance'] | null; title?: string } = {},
): GoalNodeView =>
  ({
    acceptance: acceptance ?? undefined,
    node: { id, kind: 'task', status: 'resolved', title },
  }) as unknown as GoalNodeView;

const graph = (nodes: GoalNodeView[]): GoalGraphView =>
  ({
    byId: Object.fromEntries(nodes.map((view) => [view.node.id, view])),
    goal: { config: { report: { nodeId: REPORT_NODE_ID } }, status: 'achieved' },
    nodes,
  }) as unknown as GoalGraphView;

const goalLevel = (status: string) =>
  acceptanceNode('node-goal-acceptance', status, {
    title: GOAL_ACCEPTANCE_TASK_TITLE,
  });

const reportTask = () =>
  acceptanceNode(REPORT_NODE_ID, 'accepted', { title: GOAL_REPORT_TASK_TITLE });

describe('buildAcceptanceTree', () => {
  it('把目标级验收放在任务级验收之上', () => {
    const tree = buildAcceptanceTree(
      graph([
        acceptanceNode('t1', 'accepted'),
        acceptanceNode('t2', 'delivered'),
        goalLevel('delivered'),
        reportTask(),
      ]),
    );

    expect(tree.goal?.key).toBe('node-goal-acceptance');
    expect(tree.goal?.state).toBe('awaitingSignOff');
    expect(tree.tasks.map((level) => level.key)).toEqual(['t1', 't2']);
  });

  it('只列工作任务：验收任务与总结任务不属于层级里的任务级', () => {
    const view = graph([
      acceptanceNode('t1', 'accepted'),
      acceptanceNode('t2', 'accepted'),
      goalLevel('accepted'),
      reportTask(),
    ]);

    // 与页面别处统计任务规模的口径一致 —— 两处不能各数各的。
    expect(buildAcceptanceTree(view).tasks).toHaveLength(countGoalTasks(view));
  });

  it('状态映射：已交付/出错等决策，已通过即已验收', () => {
    const tree = buildAcceptanceTree(
      graph([
        acceptanceNode('delivered', 'delivered'),
        acceptanceNode('errored', 'errored'),
        acceptanceNode('accepted', 'accepted'),
        acceptanceNode('rejected', 'rejected'),
        acceptanceNode('verifying', 'verifying'),
        acceptanceNode('pending', 'pending'),
        acceptanceNode('closed', 'closed'),
      ]),
    );

    expect(tree.tasks.map((level) => level.state)).toEqual([
      'awaitingSignOff',
      'awaitingSignOff',
      'signedOff',
      'rejected',
      'inProgress',
      'inProgress',
      'closed',
    ]);
  });

  it('未派发的任务读作「没有验收」，而不是通过', () => {
    const tree = buildAcceptanceTree(
      graph([
        acceptanceNode('t1', 'accepted'),
        acceptanceNode('never-ran', 'pending', { acceptance: null }),
      ]),
    );

    const undispatched = tree.tasks.find((level) => level.key === 'never-ran');
    expect(undispatched?.state).toBe('unavailable');
    expect(undispatched?.acceptanceId).toBeUndefined();
  });

  it('回归：目标级状态取它自己的验收状态，不由子项推导', () => {
    // 子任务被打了回，但目标级验收还没被判定 —— 层级顶部必须仍然是
    // 「等你验收」，不能因为下面有失败就自己变红。
    const tree = buildAcceptanceTree(
      graph([acceptanceNode('t1', 'rejected'), goalLevel('delivered')]),
    );

    expect(tree.goal?.state).toBe('awaitingSignOff');
  });

  it('回归：没有验收就没有层级，不用空树冒充满足条件的树', () => {
    const tree = buildAcceptanceTree(
      graph([acceptanceNode('never-ran', 'pending', { acceptance: null })]),
    );

    expect(tree.goal).toBeUndefined();
    expect(hasAcceptanceTree(tree)).toBe(true);
    expect(hasAcceptanceTree(buildAcceptanceTree(graph([])))).toBe(false);
  });

  it('带上当前轮的计数，没有轮次的验收不带', () => {
    const withChecks = acceptanceNode('t1', 'delivered', {
      acceptance: {
        checks: { failed: 1, passed: 3, total: 4, unjudged: 0 },
        id: 'acc-t1',
        status: 'delivered',
      } as GoalNodeView['acceptance'],
    });

    const tree = buildAcceptanceTree(graph([withChecks, acceptanceNode('t2', 'pending')]));

    expect(tree.tasks[0].checks).toEqual({ failed: 1, passed: 3, total: 4, unjudged: 0 });
    expect(tree.tasks[1].checks).toBeUndefined();
  });
});
