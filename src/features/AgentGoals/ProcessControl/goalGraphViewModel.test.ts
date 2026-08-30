import type {
  GoalGraphDecision,
  GoalGraphEdge,
  GoalGraphEvent,
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalItem,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildGoalGraphView } from './goalGraphViewModel';

const T0 = new Date('2026-08-01T00:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const NOW = at(120).getTime();

const goal = (overrides: Partial<GoalItem> = {}): GoalItem => ({
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
  subjectType: 'standalone',
  title: 'Goal',
  updatedAt: T0,
  userId: 'user-1',
  workspaceId: null,
  ...overrides,
});

const node = (id: string, overrides: Partial<GoalGraphNode> = {}): GoalGraphNode => ({
  confidence: null,
  createdAt: at(1),
  createdByAgentId: null,
  createdByUserId: null,
  description: null,
  goalId: 'goal-1',
  id,
  kind: 'task',
  priority: 0,
  resolvedAt: null,
  status: 'proposed',
  taskId: null,
  title: id,
  updatedAt: at(1),
  ...overrides,
});

const edge = (source: string, target: string, kind: GoalGraphEdge['kind']): GoalGraphEdge => ({
  createdAt: at(1),
  goalId: 'goal-1',
  id: `${source}-${target}-${kind}`,
  kind,
  sourceNodeId: source,
  targetNodeId: target,
});

const event = (
  entityId: string,
  eventType: GoalGraphEvent['eventType'],
  minutes: number,
  reason?: string,
): GoalGraphEvent => ({
  actorId: 'user-1',
  actorType: 'agent',
  createdAt: at(minutes),
  entityId,
  entityType: 'node',
  eventType,
  goalId: 'goal-1',
  id: `${entityId}-${eventType}-${minutes}`,
  operationId: null,
  reason: reason ?? null,
  taskId: null,
});

const snapshot = (partial: Partial<GoalGraphSnapshot>): GoalGraphSnapshot => ({
  decisions: [],
  edges: [],
  events: [],
  goal: goal(),
  nodes: [],
  workVersions: [],
  ...partial,
});

describe('buildGoalGraphView', () => {
  it('mirrors the coordinator frontier: unblocked work is ready, blocked work folds', () => {
    const view = buildGoalGraphView(
      snapshot({
        edges: [edge('w2', 'w1', 'depends_on')],
        nodes: [node('w1'), node('w2')],
      }),
      NOW,
    );

    expect(view.frontier.map((item) => [item.view.node.id, item.kind])).toEqual([['w1', 'ready']]);
    expect(view.blocked.map((item) => item.node.id)).toEqual(['w2']);
  });

  it('numbers work nodes by graph creation order so dependency refs stay stable', () => {
    const view = buildGoalGraphView(
      snapshot({ nodes: [node('w1'), node('p1', { kind: 'problem' }), node('w2')] }),
      NOW,
    );

    expect(view.byId.w1.seq).toBe(1);
    expect(view.byId.w2.seq).toBe(2);
    expect(view.byId.p1.seq).toBeUndefined();
  });

  it('builds the attempt ledger from the event trail', () => {
    const view = buildGoalGraphView(
      snapshot({
        events: [
          event('w1', 'activated', 5),
          event('w1', 'updated', 20, 'Work attempt budget was exhausted'),
          event('w1', 'activated', 25, 'retry with the missing directory created first'),
          event('w1', 'resolved', 40, 'Responsible task completed'),
        ],
        nodes: [node('w1', { resolvedAt: at(40), status: 'resolved', updatedAt: at(40) })],
      }),
      NOW,
    );

    expect(view.byId.w1.attempts).toMatchObject([
      { index: 1, outcome: 'failed', reason: 'Work attempt budget was exhausted' },
      { index: 2, outcome: 'passed', reason: 'Responsible task completed' },
    ]);
  });

  it('does not let a bookkeeping `updated` event close a live attempt', () => {
    // The graph model writes `updated` for housekeeping too ("Attached Work
    // version …"). Treating it as an outcome ended the running attempt one
    // event early, which dropped the frontier row's live clock.
    const view = buildGoalGraphView(
      snapshot({
        events: [
          event('w1', 'activated', 115),
          event('w1', 'updated', 115, 'Attached Work version 704ace21'),
        ],
        nodes: [node('w1', { status: 'active', taskId: 'task-1', updatedAt: at(115) })],
      }),
      NOW,
    );

    expect(view.byId.w1.attempts).toMatchObject([{ index: 1, outcome: 'running' }]);
    expect(view.byId.w1.startedAt).toEqual(at(115));
    expect(view.frontier[0]).toMatchObject({ kind: 'running' });
  });

  it('marks an active work stale once it outlives the operation lease', () => {
    const view = buildGoalGraphView(
      snapshot({
        events: [event('w1', 'activated', 30)],
        nodes: [node('w1', { status: 'active', taskId: 'task-1', updatedAt: at(30) })],
      }),
      NOW,
    );

    expect(view.byId.w1.isStale).toBe(true);
    expect(view.frontier[0]).toMatchObject({ kind: 'stale', rank: 0 });
    expect(view.needsYou).toBe(1);
  });

  it('keeps a fresh active work running, with the current attempt start for the clock', () => {
    const view = buildGoalGraphView(
      snapshot({
        events: [event('w1', 'activated', 115)],
        nodes: [node('w1', { status: 'active', taskId: 'task-1', updatedAt: at(115) })],
      }),
      NOW,
    );

    expect(view.frontier[0]).toMatchObject({ kind: 'running', rank: 1 });
    expect(view.byId.w1.startedAt).toEqual(at(115));
  });

  it('closes the parked attempt of a Work waiting at a gate', () => {
    // The gate is written as an `updated` event, which is not an attempt
    // boundary — without the node-state fallback the parked Work kept
    // reporting a running attempt, and the gate case read as still executing.
    const view = buildGoalGraphView(
      snapshot({
        events: [
          event('w1', 'activated', 5),
          event('w1', 'updated', 40, 'Work attempt budget was exhausted'),
        ],
        nodes: [node('w1', { status: 'waiting', taskId: 'task-1', updatedAt: at(40) })],
      }),
      NOW,
    );

    expect(view.byId.w1.attempts).toMatchObject([
      { endedAt: at(40), index: 1, outcome: 'failed', reason: 'Work attempt budget was exhausted' },
    ]);
    expect(view.byId.w1.startedAt).toBeUndefined();
  });

  it('surfaces a pending gate and hides the waiting work it was opened for', () => {
    const decision: GoalGraphDecision = {
      authority: 'user',
      canceledAt: null,
      createdAt: at(50),
      id: 'dec-1',
      nodeId: 'd1',
      options: [
        { id: 'retry', label: 'Retry work' },
        { id: 'retire', label: 'Retire work' },
      ],
      question: 'Retry or retire?',
      recommendedOptionId: 'retry',
      requestedProjectRole: null,
      requestedUserId: 'user-1',
      resolution: null,
      resolvedAt: null,
      resolvedByAgentId: null,
      resolvedByUserId: null,
      resolvedOptionId: null,
      status: 'pending',
      updatedAt: at(50),
    };
    const view = buildGoalGraphView(
      snapshot({
        decisions: [decision],
        edges: [edge('w1', 'd1', 'leads_to')],
        nodes: [
          node('w1', { status: 'waiting' }),
          node('d1', { kind: 'decision', status: 'waiting' }),
        ],
      }),
      NOW,
    );

    expect(view.frontier.map((item) => [item.view.node.id, item.kind])).toEqual([['d1', 'gate']]);
    expect(view.byId.d1.decision?.id).toBe('dec-1');
    // The gate's case is the failed Work's ledger, not the decision node's own.
    expect(view.byId.d1.gateSubjectId).toBe('w1');
  });

  it('links a finding to the work that produced it and the problem it answers', () => {
    const view = buildGoalGraphView(
      snapshot({
        edges: [edge('w1', 'f1', 'produces'), edge('f1', 'p1', 'supports')],
        nodes: [
          node('p1', { kind: 'problem' }),
          node('w1', { resolvedAt: at(40), status: 'resolved' }),
          node('f1', { kind: 'finding', status: 'resolved' }),
        ],
      }),
      NOW,
    );

    expect(view.byId.f1.producedBy?.id).toBe('w1');
    expect(view.byId.f1.answers.map((n) => n.id)).toEqual(['p1']);
    expect(view.byId.w1.findings.map((n) => n.id)).toEqual(['f1']);
  });

  it('keeps only the most recent finished tasks, ahead of the live rows', () => {
    const view = buildGoalGraphView(
      snapshot({
        nodes: [
          node('w1', { resolvedAt: at(10), status: 'resolved' }),
          node('w2', { resolvedAt: at(20), status: 'resolved' }),
          node('w3', { resolvedAt: at(30), status: 'resolved' }),
          node('w4'),
        ],
      }),
      NOW,
    );

    expect(view.frontier.map((item) => item.view.node.id)).toEqual(['w3', 'w2', 'w4']);
    expect(view.advanceable).toBe(1);
  });

  it('counts registered work versions per node', () => {
    const view = buildGoalGraphView(
      snapshot({
        nodes: [node('w1')],
        workVersions: [
          { createdAt: at(5), id: 'l1', nodeId: 'w1', relation: 'produced', workVersionId: 'v1' },
          { createdAt: at(9), id: 'l2', nodeId: 'w1', relation: 'produced', workVersionId: 'v2' },
        ],
      }),
      NOW,
    );

    expect(view.byId.w1.artifactCount).toBe(2);
  });
});
