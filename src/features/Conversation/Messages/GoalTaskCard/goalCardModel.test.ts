import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import type { GoalGraphNode, GoalGraphSnapshot, GoalItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildGoalCardModel, windowPlanSteps } from './goalCardModel';

const T0 = new Date('2026-08-01T00:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const NOW = at(120).getTime();

const goal = (overrides: Partial<GoalItem> = {}): GoalItem =>
  ({
    agentId: 'agt',
    completedAt: null,
    config: { recovery: { operationLeaseTimeoutMs: 15 * 60_000 } },
    createdAt: T0,
    id: 'goal-1',
    maxRounds: null,
    maxTotalCost: null,
    projectId: null,
    requirement: 'ship it',
    startedAt: T0,
    status: 'running',
    subjectId: null,
    subjectType: 'topic',
    title: 'Goal',
    updatedAt: T0,
    userId: 'user-1',
    workspaceId: null,
    ...overrides,
  }) as GoalItem;

let seq = 0;
const node = (overrides: Partial<GoalGraphNode> = {}): GoalGraphNode => {
  seq += 1;
  return {
    confidence: null,
    createdAt: at(seq),
    createdByAgentId: null,
    createdByUserId: null,
    description: null,
    goalId: 'goal-1',
    id: `n${seq}`,
    kind: 'task',
    priority: 0,
    resolvedAt: null,
    status: 'proposed',
    taskId: null,
    title: `step ${seq}`,
    updatedAt: at(seq),
    ...overrides,
  };
};

const snapshot = (overrides: Partial<GoalGraphSnapshot> = {}): GoalGraphSnapshot =>
  ({
    decisions: [],
    edges: [],
    events: [],
    goal: goal(),
    nodes: [],
    workVersions: [],
    ...overrides,
  }) as GoalGraphSnapshot;

const build = (overrides: Partial<GoalGraphSnapshot>) =>
  buildGoalCardModel(snapshot(overrides), { now: NOW });

describe('buildGoalCardModel', () => {
  it('reads a running goal with no task yet as planning', () => {
    const model = build({ nodes: [node({ kind: 'problem', status: 'active' })] });

    expect(model).toMatchObject({ stage: 'planning', steps: [], taskTotal: 0, tone: 'active' });
  });

  it('lays the plan out in order with each task state, and counts what closed', () => {
    const model = build({
      nodes: [
        node({ kind: 'problem', status: 'active' }),
        node({ status: 'resolved', title: 'research' }),
        node({ status: 'active', taskId: 'task-2', title: 'write', updatedAt: at(118) }),
        node({ title: 'save' }),
        node({ kind: 'finding', status: 'resolved' }),
      ],
      spend: { byTask: [], runs: 2, totalCost: 0.23, totalTokens: 1 },
    });

    expect(model.stage).toBe('executing');
    expect(model.steps.map(({ state, title }) => [title, state])).toEqual([
      ['research', 'done'],
      ['write', 'running'],
      ['save', 'queued'],
    ]);
    expect(model).toMatchObject({ findingCount: 1, taskDone: 1, taskTotal: 3, totalCost: 0.23 });
  });

  it('marks a task whose run went silent as lost', () => {
    const model = build({
      nodes: [node({ status: 'active', taskId: 'task-1', updatedAt: at(10) })],
    });

    expect(model.steps[0].state).toBe('lost');
  });

  it('lets a pending decision color the stage as waiting on the user', () => {
    const model = build({
      decisions: [{ id: 'd1', status: 'pending' }] as never,
      goal: goal({ status: 'paused' }),
      nodes: [node({ status: 'resolved' }), node()],
    });

    expect(model).toMatchObject({ needsYou: 1, stage: 'executing', tone: 'waiting' });
  });

  it('reads a stopped goal whose tasks all closed as stopped at acceptance', () => {
    const model = build({
      goal: goal({ status: 'failed' }),
      nodes: [node({ status: 'resolved' }), node({ status: 'rejected' })],
    });

    expect(model).toMatchObject({ stage: 'verifying', tone: 'error' });
  });

  it('reaches the last stage once achieved', () => {
    expect(build({ goal: goal({ status: 'achieved' }) }).stage).toBe('achieved');
  });

  it('names the coordinator acceptance task with its fixed title', () => {
    const model = build({ nodes: [node({ title: GOAL_ACCEPTANCE_TASK_TITLE })] });

    expect(model.steps[0].titleKey).toBe('goalProcess.node.terminalAcceptance');
  });
});

describe('windowPlanSteps', () => {
  const steps = (states: string[]) =>
    states.map((state, index) => ({ id: `s${index}`, state, title: `s${index}` })) as never;

  it('shows the whole plan when it fits', () => {
    expect(windowPlanSteps(steps(['done', 'running']), 4)).toMatchObject({
      hiddenAfter: 0,
      hiddenBefore: 0,
    });
  });

  it('starts one step before the first open task and folds the rest', () => {
    const result = windowPlanSteps(
      steps(['done', 'done', 'done', 'running', 'queued', 'queued', 'queued']),
      4,
    );

    expect(result.visible.map((step) => step.id)).toEqual(['s2', 's3', 's4', 's5']);
    expect(result).toMatchObject({ hiddenAfter: 1, hiddenBefore: 2 });
  });

  it('keeps the tail in view when every task closed', () => {
    const result = windowPlanSteps(steps(['done', 'done', 'done', 'done', 'done', 'done']), 4);

    expect(result).toMatchObject({ hiddenAfter: 0, hiddenBefore: 2 });
  });
});
