import type { GoalGraphNode, GoalGraphSnapshot, TaskItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  compareMetric,
  decideNextMove,
  frontierNeedsBudget,
  GOAL_ACCEPTANCE_TASK_TITLE,
  LEASE_EXPIRED_ERROR,
  needsBudget,
  needsMetricCriteria,
  selectFrontier,
  VERIFICATION_FAILED_ERROR,
} from './decideNextMove';

const node = (id: string, overrides: Partial<GoalGraphNode> = {}): GoalGraphNode =>
  ({
    createdAt: new Date(1000),
    id,
    kind: 'task',
    priority: 0,
    status: 'proposed',
    taskId: null,
    title: id,
    ...overrides,
  }) as GoalGraphNode;

const graph = (overrides: Partial<GoalGraphSnapshot> = {}): GoalGraphSnapshot =>
  ({
    decisions: [],
    edges: [],
    events: [],
    goal: { id: 'goal_1', maxRounds: null, maxTotalCost: null, status: 'running', title: 'G' },
    nodes: [],
    workVersions: [],
    ...overrides,
  }) as GoalGraphSnapshot;

const task = (overrides: Partial<TaskItem> = {}): TaskItem =>
  ({ error: null, id: 'task_1', identifier: 'T-1', status: 'backlog', ...overrides }) as TaskItem;

/**
 * `frontierTask` is the old single-node shape these tests were written
 * against; it is expressed as the one-entry task map the scheduler now takes,
 * so the existing cases keep reading as "this node, this task".
 */
const decide = (
  snapshot: GoalGraphSnapshot,
  extra: {
    budget?: Parameters<typeof decideNextMove>[0]['budget'];
    concurrency?: number;
    frontierTask?: TaskItem | null;
    metricCriteria?: Parameters<typeof decideNextMove>[0]['metricCriteria'];
    tasks?: TaskItem[];
  } = {},
) => {
  const { budget, concurrency = 3, frontierTask, metricCriteria, tasks } = extra;
  const listed = tasks ?? (frontierTask ? [frontierTask] : []);
  return decideNextMove({
    budget,
    concurrency,
    frontier: selectFrontier(snapshot),
    graph: snapshot,
    metricCriteria,
    tasksById: new Map(listed.map((item) => [item.id, item])),
  });
};

describe('selectFrontier', () => {
  it('ranks by priority, then by creation order', () => {
    const snapshot = graph({
      nodes: [
        node('late', { createdAt: new Date(3000) }),
        node('early', { createdAt: new Date(2000) }),
        node('urgent', { priority: 5, createdAt: new Date(9000) }),
      ],
    });

    expect(selectFrontier(snapshot).candidates.map((item) => item.nodeId)).toEqual([
      'urgent',
      'early',
      'late',
    ]);
  });

  it('keeps blocked nodes as candidates but never chooses them', () => {
    const snapshot = graph({
      edges: [
        { id: 'e1', kind: 'depends_on', sourceNodeId: 'b', targetNodeId: 'a' },
      ] as GoalGraphSnapshot['edges'],
      nodes: [node('a', { priority: -1 }), node('b', { priority: 5 })],
    });

    const selection = selectFrontier(snapshot);

    expect(selection.candidates[0]).toMatchObject({ blockedBy: ['a'], nodeId: 'b' });
    expect(selection.chosen?.id).toBe('a');
  });

  it('drops terminal Tasks from the frontier', () => {
    const snapshot = graph({
      nodes: [node('done', { status: 'resolved' }), node('gone', { status: 'retired' })],
    });

    expect(selectFrontier(snapshot).candidates).toEqual([]);
  });
});

describe('decideNextMove', () => {
  it('stops on a paused or terminal goal before looking at Tasks', () => {
    const nodes = [node('a')];
    expect(decide(graph({ goal: { ...graph().goal, status: 'paused' }, nodes })).branch).toBe(
      'goal_paused',
    );
    expect(decide(graph({ goal: { ...graph().goal, status: 'achieved' }, nodes })).branch).toBe(
      'goal_terminal',
    );
    expect(decide(graph({ goal: { ...graph().goal, status: 'canceled' }, nodes })).outcome).toBe(
      'failed',
    );
  });

  it('parks on an open gate ahead of any ready Task', () => {
    const move = decide(
      graph({
        decisions: [
          { id: 'd1', nodeId: 'n1', question: 'Retry or retire?', status: 'pending' },
        ] as GoalGraphSnapshot['decisions'],
        nodes: [node('a')],
      }),
    );

    expect(move).toMatchObject({
      branch: 'pending_decision',
      focusNodeId: 'n1',
      message: 'Retry or retire?',
      outcome: 'waiting_human',
    });
  });

  it('asks for a responsible runner when the chosen Task has none', () => {
    expect(decide(graph({ nodes: [node('a')] }))).toMatchObject({
      branch: 'create_task',
      chosenNodeId: 'a',
      outcome: 'advanced',
    });
  });

  it('reports a missing task row rather than dispatching into nothing', () => {
    const snapshot = graph({ nodes: [node('a', { taskId: 'task_1' })] });

    expect(decide(snapshot, { frontierTask: null })).toMatchObject({
      branch: 'missing_task',
      outcome: 'failed',
    });
  });

  describe('with a responsible task', () => {
    const snapshot = graph({ nodes: [node('a', { taskId: 'task_1' })] });

    it('folds a completed task into a finding', () => {
      expect(decide(snapshot, { frontierTask: task({ status: 'completed' }) }).branch).toBe(
        'consume_completed',
      );
    });

    it('separates the two recoverable failures from the ones that need a person', () => {
      expect(
        decide(snapshot, {
          frontierTask: task({ error: LEASE_EXPIRED_ERROR, status: 'paused' }),
        }).branch,
      ).toBe('recover_lease');

      expect(
        decide(snapshot, {
          frontierTask: task({ error: VERIFICATION_FAILED_ERROR, status: 'paused' }),
        }).branch,
      ).toBe('recover_verification');

      expect(
        decide(snapshot, { frontierTask: task({ error: 'Device offline', status: 'failed' }) }),
      ).toMatchObject({ branch: 'failure_decision', message: 'Device offline' });
    });

    it('treats a plain pause as waiting on a person and a run as waiting on the world', () => {
      expect(decide(snapshot, { frontierTask: task({ status: 'paused' }) })).toMatchObject({
        branch: 'task_paused',
        outcome: 'waiting_human',
      });
      expect(decide(snapshot, { frontierTask: task({ status: 'running' }) })).toMatchObject({
        branch: 'task_running',
        outcome: 'waiting_external',
      });
    });

    it('stops on an exhausted budget instead of dispatching', () => {
      const move = decide(snapshot, {
        budget: {
          costLimitReached: false,
          maxRounds: 3,
          roundLimitReached: true,
          runs: 3,
          totalCost: 1,
        },
        frontierTask: task(),
      });

      expect(move).toMatchObject({ branch: 'budget_exhausted', outcome: 'no_progress' });
      expect(move.message).toContain('3/');
    });

    it('stops when the deadline passed instead of dispatching', () => {
      // A calendar deadline is a budget unit the attempt/round/dollar trio
      // cannot express; past it the coordinator must park the goal exactly
      // like any other exhausted budget.
      const move = decide(snapshot, {
        budget: {
          costLimitReached: false,
          deadlinePassed: true,
          roundLimitReached: false,
          runs: 0,
          totalCost: 0,
        },
        frontierTask: task(),
      });

      expect(move).toMatchObject({ branch: 'budget_exhausted', outcome: 'no_progress' });
      expect(move.message).toContain('Deadline passed');
    });

    it('checks the deadline before the round and cost budgets', () => {
      const move = decide(snapshot, {
        budget: {
          costLimitReached: true,
          deadlinePassed: true,
          roundLimitReached: true,
          runs: 9,
          totalCost: 9,
        },
        frontierTask: task(),
      });

      expect(move.message).toContain('Deadline passed');
    });

    it('dispatches when the budget still has room', () => {
      expect(
        decide(snapshot, {
          budget: {
            costLimitReached: false,
            deadlinePassed: false,
            roundLimitReached: false,
            runs: 1,
            totalCost: 0.5,
          },
          frontierTask: task(),
        }).branch,
      ).toBe('dispatch_task');
    });
  });

  describe('with no ready Tasks', () => {
    it('plans the decomposition for an empty graph, parks a fully blocked one', () => {
      // A goal with no tasks has not been planned yet — that is the planner's
      // cue, not a dead end.
      expect(decide(graph())).toMatchObject({
        branch: 'plan_decomposition',
        outcome: 'advanced',
      });

      const blocked = graph({
        edges: [
          { id: 'e1', kind: 'depends_on', sourceNodeId: 'b', targetNodeId: 'missing' },
        ] as GoalGraphSnapshot['edges'],
        nodes: [node('b')],
      });
      expect(decide(blocked)).toMatchObject({
        branch: 'no_frontier',
        outcome: 'no_progress',
      });
    });

    it('moves to the terminal acceptance contract once every Task is done', () => {
      const snapshot = graph({
        goal: { ...graph().goal, requirement: 'Prove it' },
        nodes: [node('a', { status: 'resolved' })],
      });

      expect(decide(snapshot)).toMatchObject({
        branch: 'terminal_acceptance',
        outcome: 'advanced',
      });
    });

    it('holds the goal open while its acceptance Task has not passed', () => {
      const snapshot = graph({
        goal: { ...graph().goal, requirement: 'Prove it' },
        nodes: [
          node('a', { status: 'resolved' }),
          node('acc', { status: 'retired', title: GOAL_ACCEPTANCE_TASK_TITLE }),
        ],
      });

      expect(decide(snapshot)).toMatchObject({
        branch: 'terminal_acceptance',
        focusNodeId: 'acc',
        outcome: 'no_progress',
      });
    });

    it('achieves the goal when acceptance resolved, or when there is no requirement', () => {
      const withAcceptance = graph({
        goal: { ...graph().goal, requirement: 'Prove it' },
        nodes: [
          node('a', { status: 'resolved' }),
          node('acc', { status: 'resolved', title: GOAL_ACCEPTANCE_TASK_TITLE }),
        ],
      });
      expect(decide(withAcceptance).outcome).toBe('achieved');

      const withoutRequirement = graph({ nodes: [node('a', { status: 'resolved' })] });
      expect(decide(withoutRequirement).outcome).toBe('achieved');
    });
  });
});

describe('needsBudget', () => {
  it('is true only for a task the coordinator could still start', () => {
    expect(needsBudget(task({ status: 'backlog' }))).toBe(true);
    expect(needsBudget(task({ status: 'running' }))).toBe(false);
    expect(needsBudget(task({ status: 'completed' }))).toBe(false);
    expect(needsBudget(null)).toBe(false);
  });
});

describe('decideNextMove concurrency', () => {
  const independent = (count: number) =>
    graph({
      nodes: Array.from({ length: count }, (_, index) =>
        node(`n${index}`, { createdAt: new Date(1000 + index) }),
      ),
    });

  it('moves past a running task to start an independent one', () => {
    // The whole point: four fixes that share no code should not queue behind
    // each other. The old frontier stopped at its head, saw it running, and
    // ended the advance.
    const snapshot = graph({
      nodes: [node('a', { taskId: 'task_1' }), node('b'), node('c')],
    });

    expect(decide(snapshot, { tasks: [task({ id: 'task_1', status: 'running' })] })).toMatchObject({
      branch: 'create_task',
      chosenNodeId: 'b',
    });
  });

  it('stops once the concurrency limit is reached', () => {
    const snapshot = graph({
      nodes: [node('a', { taskId: 'task_1' }), node('b', { taskId: 'task_2' }), node('c')],
    });

    const move = decide(snapshot, {
      concurrency: 2,
      tasks: [task({ id: 'task_1', status: 'running' }), task({ id: 'task_2', status: 'running' })],
    });

    expect(move).toMatchObject({ branch: 'task_running', outcome: 'waiting_external' });
    expect(move.message).toContain('concurrency limit of 2');
  });

  it('fills the remaining slots rather than only the first', () => {
    // Dispatching reports `advanced`, so the advance loop keeps going and the
    // next tick picks the next idle node.
    const move = decide(independent(4), {
      concurrency: 3,
      tasks: [task({ id: 'task_1', status: 'running' })],
    });

    expect(move.outcome).toBe('advanced');
  });

  it('does not let a paused task block an independent Task', () => {
    const snapshot = graph({ nodes: [node('a', { taskId: 'task_1' }), node('b')] });

    expect(decide(snapshot, { tasks: [task({ id: 'task_1', status: 'paused' })] })).toMatchObject({
      branch: 'create_task',
      chosenNodeId: 'b',
    });
  });

  it('reports the human wait only when every ready task is parked', () => {
    const snapshot = graph({ nodes: [node('a', { taskId: 'task_1' })] });

    expect(decide(snapshot, { tasks: [task({ id: 'task_1', status: 'paused' })] })).toMatchObject({
      branch: 'task_paused',
      outcome: 'waiting_human',
    });
  });

  it('still respects dependencies when running in parallel', () => {
    const snapshot = graph({
      edges: [
        { id: 'e1', kind: 'depends_on', sourceNodeId: 'b', targetNodeId: 'a' },
      ] as GoalGraphSnapshot['edges'],
      nodes: [node('a', { taskId: 'task_1' }), node('b')],
    });

    // `a` is running and `b` depends on it, so there is nothing else to start.
    expect(decide(snapshot, { tasks: [task({ id: 'task_1', status: 'running' })] })).toMatchObject({
      branch: 'task_running',
      outcome: 'waiting_external',
    });
  });
});

describe('frontierNeedsBudget', () => {
  const withTasks = (snapshot: GoalGraphSnapshot, tasks: TaskItem[]) =>
    frontierNeedsBudget(selectFrontier(snapshot), new Map(tasks.map((item) => [item.id, item])));

  it('is true when a later candidate can start even though the head cannot', () => {
    // The hole parallelism opened: the head is running and needs no budget, so
    // asking only the head would skip the budget read entirely — and
    // `budget_exhausted` can only fire on a budget that was read.
    const snapshot = graph({ nodes: [node('a', { taskId: 'task_1' }), node('b')] });

    expect(withTasks(snapshot, [task({ id: 'task_1', status: 'running' })])).toBe(true);
  });

  it('is false when nothing unblocked could start paid work', () => {
    const snapshot = graph({ nodes: [node('a', { taskId: 'task_1' })] });

    expect(withTasks(snapshot, [task({ id: 'task_1', status: 'running' })])).toBe(false);
    expect(withTasks(snapshot, [task({ id: 'task_1', status: 'completed' })])).toBe(false);
  });

  it('is true for a retryable failure, which spends money too', () => {
    const snapshot = graph({ nodes: [node('a', { taskId: 'task_1' })] });

    expect(
      withTasks(snapshot, [
        task({ error: VERIFICATION_FAILED_ERROR, id: 'task_1', status: 'paused' }),
      ]),
    ).toBe(true);
  });

  it('ignores blocked candidates', () => {
    const snapshot = graph({
      edges: [
        { id: 'e1', kind: 'depends_on', sourceNodeId: 'b', targetNodeId: 'a' },
      ] as GoalGraphSnapshot['edges'],
      nodes: [node('a', { taskId: 'task_1' }), node('b')],
    });

    expect(withTasks(snapshot, [task({ id: 'task_1', status: 'running' })])).toBe(false);
  });
});

describe('needsMetricCriteria', () => {
  const withCriteria = (nodes: GoalGraphNode[]) =>
    graph({
      goal: {
        ...graph().goal,
        config: { acceptance: { metrics: [{ key: 'followers', target: 1_000_000 }] } },
      },
      nodes,
    });

  it('only asks for criteria in the terminal phase of a goal that declares them', () => {
    // Evaluating them is a database read per clause; a dispatch tick must not
    // pay for it.
    expect(needsMetricCriteria(withCriteria([node('a', { status: 'resolved' })]))).toBe(true);
    expect(needsMetricCriteria(withCriteria([node('a', { status: 'active' })]))).toBe(false);
    expect(needsMetricCriteria(withCriteria([]))).toBe(false);
    expect(needsMetricCriteria(graph({ nodes: [node('a', { status: 'resolved' })] }))).toBe(false);
  });
});

describe('compareMetric', () => {
  it('evaluates each comparison', () => {
    expect(compareMetric(10, 'gte', 10)).toBe(true);
    expect(compareMetric(9, 'gte', 10)).toBe(false);
    expect(compareMetric(10, 'gt', 10)).toBe(false);
    expect(compareMetric(10, 'lte', 10)).toBe(true);
    expect(compareMetric(11, 'lt', 10)).toBe(false);
    expect(compareMetric(10, 'eq', 10)).toBe(true);
  });

  it('reads both operands at the scale observations are stored with', () => {
    // `metric_points.value` is numeric(20, 6): recording 0.1234567 reads back
    // as 0.123457, so a full-precision target would make the clause
    // unsatisfiable and could flip gte/lte right at the boundary.
    expect(compareMetric(0.123_457, 'eq', 0.123_456_7)).toBe(true);
    expect(compareMetric(0.123_457, 'gte', 0.123_456_7)).toBe(true);
    expect(compareMetric(0.123_457, 'lte', 0.123_456_7)).toBe(true);
    // Differences the column can still represent are not rounded away.
    expect(compareMetric(0.123_457, 'eq', 0.123_458)).toBe(false);
  });
});

describe('measured acceptance', () => {
  const terminal = graph({
    goal: { ...graph().goal, requirement: 'Prove it' },
    nodes: [node('a', { status: 'resolved' })],
  });

  it('holds the goal short of the delivery contract while a number is unmet', () => {
    // The acceptance Task is never created: an unmet number is not something a
    // verifier can talk its way past, so running it would only spend tokens to
    // restate the gap.
    const move = decide(terminal, {
      metricCriteria: {
        allMet: false,
        criteria: [{ key: 'followers', met: false, op: 'gte', target: 1_000_000, value: 4200 }],
      },
    });

    expect(move).toMatchObject({ branch: 'measured_acceptance', outcome: 'no_progress' });
    expect(move.message).toContain('followers');
    expect(move.message).toContain('4200');
  });

  it('names a clause that was never measured rather than reading it as satisfied', () => {
    const move = decide(terminal, {
      metricCriteria: {
        allMet: false,
        criteria: [{ key: 'followers', met: false, op: 'gte', target: 1_000_000, value: null }],
      },
    });

    expect(move.message).toContain('no observation');
  });

  it('falls through to the delivery contract once every number holds', () => {
    expect(
      decide(terminal, {
        metricCriteria: {
          allMet: true,
          criteria: [
            { key: 'followers', met: true, op: 'gte', target: 1_000_000, value: 1_000_001 },
          ],
        },
      }),
    ).toMatchObject({ branch: 'terminal_acceptance', outcome: 'advanced' });
  });
});
