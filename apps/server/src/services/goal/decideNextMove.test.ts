import type { GoalGraphNode, GoalGraphSnapshot, TaskItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  decideNextMove,
  GOAL_ACCEPTANCE_TASK_TITLE,
  LEASE_EXPIRED_ERROR,
  needsBudget,
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

const decide = (
  snapshot: GoalGraphSnapshot,
  extra: Parameters<typeof decideNextMove>[0] extends infer T
    ? Partial<Omit<T & object, 'graph' | 'frontier'>>
    : never = {},
) => decideNextMove({ frontier: selectFrontier(snapshot), graph: snapshot, ...extra });

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

  it('drops terminal work from the frontier', () => {
    const snapshot = graph({
      nodes: [node('done', { status: 'resolved' }), node('gone', { status: 'retired' })],
    });

    expect(selectFrontier(snapshot).candidates).toEqual([]);
  });
});

describe('decideNextMove', () => {
  it('stops on a paused or terminal goal before looking at work', () => {
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

  it('parks on an open gate ahead of any ready work', () => {
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

  it('asks for a responsible task when the chosen work has none', () => {
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

    it('dispatches when the budget still has room', () => {
      expect(
        decide(snapshot, {
          budget: {
            costLimitReached: false,
            roundLimitReached: false,
            runs: 1,
            totalCost: 0.5,
          },
          frontierTask: task(),
        }).branch,
      ).toBe('dispatch_task');
    });
  });

  describe('with no ready work', () => {
    it('reports an empty graph and a fully blocked one differently', () => {
      expect(decide(graph()).message).toContain('add a work node');

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

    it('moves to the terminal acceptance contract once every Work is done', () => {
      const snapshot = graph({
        goal: { ...graph().goal, requirement: 'Prove it' },
        nodes: [node('a', { status: 'resolved' })],
      });

      expect(decide(snapshot)).toMatchObject({
        branch: 'terminal_acceptance',
        outcome: 'advanced',
      });
    });

    it('holds the goal open while its acceptance Work has not passed', () => {
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
