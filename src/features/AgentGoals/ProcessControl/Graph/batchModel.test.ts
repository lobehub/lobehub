import { GOAL_BATCH_ASSAY_TITLE, GOAL_BATCH_TEMPLATE_TITLE } from '@lobechat/const/goal';
import type {
  GoalGraphDecision,
  GoalGraphEdge,
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalRolloutState,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildGoalGraphView } from '../goalGraphViewModel';
import { batchGroupId, layoutBatch } from './batchLayout';
import {
  buildBatchModel,
  findBatchGate,
  findBatchPlan,
  reopenedRows,
  verdictChecks,
} from './batchModel';

const T0 = new Date('2026-10-01T00:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const node = (
  id: string,
  kind: GoalGraphNode['kind'],
  minute: number,
  overrides: Partial<GoalGraphNode> = {},
): GoalGraphNode => ({
  confidence: null,
  createdAt: at(minute),
  createdByAgentId: null,
  createdByUserId: null,
  description: null,
  goalId: 'goal-1',
  id,
  kind,
  priority: 0,
  resolvedAt: null,
  status: 'proposed',
  taskId: null,
  title: id,
  updatedAt: at(minute),
  ...overrides,
});

const edge = (source: string, target: string, kind: GoalGraphEdge['kind']): GoalGraphEdge => ({
  createdAt: T0,
  goalId: 'goal-1',
  id: `${source}-${target}-${kind}`,
  kind,
  sourceNodeId: source,
  targetNodeId: target,
});

const humanAnswer = (nodeId: string): GoalGraphDecision => ({
  authority: 'user',
  canceledAt: null,
  createdAt: at(30),
  id: `d-${nodeId}`,
  nodeId,
  options: [{ description: '', id: 'revise', label: 'revise' }],
  question: 'Batch gate blocked',
  recommendedOptionId: null,
  requestedProjectRole: null,
  requestedUserId: 'user-1',
  resolution: null,
  resolvedAt: at(31),
  resolvedByAgentId: null,
  resolvedByUserId: 'user-1',
  resolvedOptionId: 'revise',
  status: 'resolved',
  updatedAt: at(31),
});

const ROSTER = ['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8', 'U9', 'U10'];

/** Two probes (U1, U2), a recipe, a gate, and the rest of the roster in waves of four. */
const batchSnapshot = ({
  decisions = [],
  extraEdges = [],
  extraNodes = [],
  state,
}: {
  decisions?: GoalGraphDecision[];
  extraEdges?: GoalGraphEdge[];
  extraNodes?: GoalGraphNode[];
  state: Partial<GoalRolloutState>;
}): GoalGraphSnapshot => {
  const base = [
    node('problem', 'problem', 0),
    node('batch', 'batch', 1),
    node('t1', 'finding', 2, { title: GOAL_BATCH_TEMPLATE_TITLE }),
    node('a1', 'decision', 3, { title: GOAL_BATCH_ASSAY_TITLE }),
    node('p1', 'task', 4, { status: 'resolved', title: 'U1' }),
    node('p2', 'task', 5, { status: 'resolved', title: 'U2' }),
  ];
  const nodes = [...base, ...extraNodes];
  const contained = nodes.filter((n) => n.id !== 'problem' && n.id !== 'batch');
  return {
    decisions,
    edges: [
      edge('problem', 'batch', 'decomposes'),
      ...contained.map((n) => edge('batch', n.id, 'contains')),
      edge('a1', 'p1', 'depends_on'),
      edge('a1', 'p2', 'depends_on'),
      ...extraEdges,
    ],
    events: [],
    goal: {
      agentId: 'agt',
      completedAt: null,
      config: {
        rollout: { trigger: 'canary', units: ROSTER, waveSize: 4 },
        rolloutState: {
          assayNodeId: 'a1',
          batchNodeId: 'batch',
          phase: 'probe',
          probeNodeIds: ['p1', 'p2'],
          templateNodeId: 't1',
          templateRevision: 1,
          unitTitles: ROSTER,
          waveIndex: 0,
          ...state,
        },
      },
      createdAt: T0,
      id: 'goal-1',
      maxRounds: null,
      maxTotalCost: null,
      projectId: null,
      requirement: 'migrate ten units',
      startedAt: T0,
      status: 'running',
      subjectId: null,
      subjectType: 'standalone',
      title: 'Batch',
      updatedAt: T0,
      userId: 'user-1',
      workspaceId: null,
    },
    nodes,
    workVersions: [],
  };
};

const NOW = at(60).getTime();

describe('buildBatchModel', () => {
  it('lays the roster out as waves, not one card per unit', () => {
    const graph = buildGoalGraphView(
      batchSnapshot({
        extraNodes: [
          node('m3', 'task', 10, { status: 'resolved', title: 'U3' }),
          node('m4', 'task', 10, { status: 'retired', title: 'U4' }),
          node('m5', 'task', 10, { title: 'U5' }),
        ],
        state: { massNodeIds: ['m3', 'm4', 'm5'], phase: 'mass', waveIndex: 1 },
      }),
      NOW,
    );
    const model = buildBatchModel(graph, 'batch');

    expect(model.rounds).toHaveLength(1);
    expect(model.rounds[0].probes.map((probe) => probe.title)).toEqual(['U1', 'U2']);
    expect(model.rounds[0].gate).toBe('passed');
    // Eight units outside the probes, four to a wave.
    expect(model.waves.map((wave) => wave.map((cell) => cell.title))).toEqual([
      ['U3', 'U4', 'U5', 'U6'],
      ['U7', 'U8', 'U9', 'U10'],
    ]);
    expect(model.waves[0].map((cell) => cell.state)).toEqual([
      'done',
      'stale',
      'backlog',
      'backlog',
    ]);
    expect(model.waves[1].every((cell) => cell.state === 'backlog' && !cell.nodeId)).toBe(true);
  });

  it('keeps the gate locked until every probe settled', () => {
    const snapshot = batchSnapshot({ state: {} });
    snapshot.nodes = snapshot.nodes.map((n) =>
      n.id === 'p2' ? { ...n, status: 'active', updatedAt: at(59) } : n,
    );
    const model = buildBatchModel(buildGoalGraphView(snapshot, NOW), 'batch');

    expect(model.rounds[0].gate).toBe('locked');
    expect(model.rounds[0].probes.map((probe) => probe.state)).toEqual(['done', 'running']);
  });

  it('opens a v2 round for a unit re-opened after a person sent the gate back', () => {
    const graph = buildGoalGraphView(
      batchSnapshot({
        decisions: [humanAnswer('a1')],
        extraEdges: [
          edge('t2', 't1', 'revises'),
          edge('a2', 'p2b', 'depends_on'),
          edge('p2b', 'p2', 'derived_from'),
        ],
        extraNodes: [
          node('t2', 'finding', 40, { title: GOAL_BATCH_TEMPLATE_TITLE }),
          node('a2', 'decision', 41, { title: GOAL_BATCH_ASSAY_TITLE }),
          node('p2b', 'task', 42, { title: 'U2' }),
        ],
        state: { assayNodeId: 'a2', probeNodeIds: ['p2b'], templateNodeId: 't2' },
      }),
      NOW,
    );
    const model = buildBatchModel(graph, 'batch');

    expect(model.rounds.map((round) => round.revision)).toEqual([1, 2]);
    expect(model.rounds[0].gate).toBe('rejected');
    const [, second] = model.rounds;
    expect(second).toMatchObject({
      assayId: 'a2',
      forked: false,
      gate: 'locked',
      templateId: 't2',
    });
    expect(second.origin).toEqual({ kind: 'probes' });
    expect(second.probes).toEqual([
      expect.objectContaining({ from: { index: 1, kind: 'probe' }, nodeId: 'p2b', title: 'U2' }),
    ]);
  });

  it('marks a wave unit superseded once a later round re-opened it', () => {
    const graph = buildGoalGraphView(
      batchSnapshot({
        decisions: [humanAnswer('a1')],
        extraEdges: [edge('a2', 'm4b', 'depends_on')],
        extraNodes: [
          node('m3', 'task', 10, { status: 'resolved', title: 'U3' }),
          node('m4', 'task', 10, { status: 'retired', title: 'U4' }),
          node('t2', 'finding', 40, { title: GOAL_BATCH_TEMPLATE_TITLE }),
          node('a2', 'decision', 41, { title: GOAL_BATCH_ASSAY_TITLE }),
          node('m4b', 'task', 42, { title: 'U4' }),
        ],
        state: { assayNodeId: 'a2', massNodeIds: ['m3', 'm4'], probeNodeIds: ['m4b'] },
      }),
      NOW,
    );
    const model = buildBatchModel(graph, 'batch');

    expect(model.waves[0][1]).toMatchObject({ nodeId: 'm4', reopenedIn: 2, state: 'stale' });
    // No `revises` edge: the person split it off as a new class.
    expect(model.rounds[1].forked).toBe(true);
    expect(model.rounds[1].origin).toEqual({ kind: 'waves', wave: 0 });
    expect(model.rounds[1].probes[0].from).toEqual({ index: 1, kind: 'wave', wave: 0 });
  });
  it('lets a unit a later round first released follow that round, not read as superseded', () => {
    const graph = buildGoalGraphView(
      batchSnapshot({
        decisions: [humanAnswer('a1')],
        extraEdges: [edge('a2', 'f3', 'depends_on')],
        extraNodes: [
          node('t2', 'finding', 40, { title: GOAL_BATCH_TEMPLATE_TITLE }),
          node('a2', 'decision', 41, { title: GOAL_BATCH_ASSAY_TITLE }),
          node('f3', 'task', 42, { status: 'resolved', title: 'U3' }),
        ],
        state: { assayNodeId: 'a2', probeNodeIds: ['f3'] },
      }),
      NOW,
    );
    const [cell] = buildBatchModel(graph, 'batch').waves[0];

    expect(cell).toMatchObject({ nodeId: 'f3', runIn: 2, state: 'done', title: 'U3' });
    expect(cell.reopenedIn).toBeUndefined();
  });
});

describe('unit states', () => {
  it('reads a rejected unit as waiting on a person and only a retired one as superseded', () => {
    const graph = buildGoalGraphView(
      batchSnapshot({
        extraNodes: [
          node('m3', 'task', 10, { status: 'rejected', title: 'U3' }),
          node('m4', 'task', 10, { status: 'retired', title: 'U4' }),
        ],
        state: { massNodeIds: ['m3', 'm4'], phase: 'pattern_break', waveIndex: 1 },
      }),
      NOW,
    );
    const [first] = buildBatchModel(graph, 'batch').waves;
    expect(first.slice(0, 2).map((cell) => cell.state)).toEqual(['human', 'stale']);
  });

  it('reads the unit that held the batch as waiting on a person, though its node is active', () => {
    const graph = buildGoalGraphView(
      batchSnapshot({
        extraNodes: [node('m3', 'task', 10, { status: 'active', title: 'U3', updatedAt: at(59) })],
        state: {
          gateLog: [
            {
              at: at(59).toISOString(),
              checks: [],
              nodeId: 'm3',
              outcome: 'blocked',
              revision: 1,
              trigger: 'unit',
              waveIndex: 1,
            },
          ],
          massNodeIds: ['m3'],
          phase: 'pattern_break',
          waveIndex: 1,
        },
      }),
      NOW,
    );
    expect(buildBatchModel(graph, 'batch').waves[0][0].state).toBe('human');
  });
});

describe('superseded trials', () => {
  it('reads a rejected trial a later round re-opened as superseded, not waiting on a person', () => {
    const snapshot = batchSnapshot({
      decisions: [humanAnswer('a1')],
      extraEdges: [
        edge('t2', 't1', 'revises'),
        edge('a2', 'p2b', 'depends_on'),
        edge('p2b', 'p2', 'derived_from'),
      ],
      extraNodes: [
        node('t2', 'finding', 40, { title: GOAL_BATCH_TEMPLATE_TITLE }),
        node('a2', 'decision', 41, { title: GOAL_BATCH_ASSAY_TITLE }),
        node('p2b', 'task', 42, { title: 'U2' }),
      ],
      state: { assayNodeId: 'a2', probeNodeIds: ['p2b'], templateNodeId: 't2' },
    });
    snapshot.nodes = snapshot.nodes.map((n) => (n.id === 'p2' ? { ...n, status: 'rejected' } : n));
    const model = buildBatchModel(buildGoalGraphView(snapshot, NOW), 'batch');
    expect(model.rounds[0].probes.find((probe) => probe.nodeId === 'p2')?.state).toBe('stale');
  });
});

describe('gate verdicts', () => {
  it('keeps the wave the coordinator wrote, even once older verdicts were trimmed', () => {
    const graph = buildGoalGraphView(
      batchSnapshot({
        state: {
          gateLog: [
            {
              at: '2026-10-01T00:20:00.000Z',
              checks: [],
              outcome: 'released',
              releasedCount: 1,
              revision: 1,
              trigger: 'gate',
              wave: 31,
              waveIndex: 31,
            },
          ],
        },
      }),
      NOW,
    );
    expect(findBatchGate(graph, 'a1')?.round.evaluations[0].wave).toBe(31);
  });

  it('reads a unit hold as the one check it broke, naming the unit', () => {
    expect(
      verdictChecks({
        at: '2026-10-01T00:30:00.000Z',
        checks: [],
        nodeId: 'm4',
        outcome: 'blocked',
        revision: 1,
        trigger: 'unit',
        waveIndex: 1,
      }),
    ).toEqual([{ key: 'units_succeeded', nodeIds: ['m4'], passed: false }]);
  });

  it('gives each round its own verdicts and finds the round from its gate', () => {
    const released = {
      at: '2026-10-01T00:20:00.000Z',
      checks: [{ count: 2, key: 'units_succeeded' as const, passed: true, total: 2 }],
      outcome: 'released' as const,
      releasedCount: 4,
      revision: 1,
      trigger: 'gate' as const,
      waveIndex: 1,
    };
    const held = {
      at: '2026-10-01T00:30:00.000Z',
      checks: [],
      nodeId: 'm4',
      outcome: 'blocked' as const,
      revision: 1,
      trigger: 'unit' as const,
      waveIndex: 1,
    };
    const graph = buildGoalGraphView(
      batchSnapshot({
        decisions: [humanAnswer('a1')],
        extraEdges: [edge('t2', 't1', 'revises'), edge('a2', 'm4b', 'depends_on')],
        extraNodes: [
          node('m4', 'task', 10, { status: 'retired', title: 'U4' }),
          node('t2', 'finding', 40, { title: GOAL_BATCH_TEMPLATE_TITLE }),
          node('a2', 'decision', 41, { title: GOAL_BATCH_ASSAY_TITLE }),
          node('m4b', 'task', 42, { title: 'U4' }),
        ],
        state: {
          assayNodeId: 'a2',
          gateLog: [released, held, { ...released, at: '2026-10-01T00:50:00.000Z', revision: 2 }],
          probeNodeIds: ['m4b'],
        },
      }),
      NOW,
    );

    const first = findBatchGate(graph, 'a1');
    expect(first?.round.revision).toBe(1);
    expect(first?.round.evaluations).toEqual([{ ...released, wave: 1 }, held]);
    // The round's own wave count restarts; the roster's does not — v2's first
    // release puts out the roster's second wave.
    const second = findBatchGate(graph, 'a2');
    expect(second?.round.evaluations.map((entry) => entry.wave)).toEqual([2]);
    // What a gate checks before its first verdict.
    expect(second?.model.gateChecks.map((check) => check.key)).toEqual([
      'units_settled',
      'units_succeeded',
      'no_open_decision',
      'plan_written',
    ]);
    // Any other node is not a gate.
    expect(findBatchGate(graph, 't1')).toBeUndefined();
  });
});

describe('wave ownership', () => {
  it('keeps a released wave with its plan and moves the waves not yet out to the latest round', () => {
    const graph = buildGoalGraphView(
      batchSnapshot({
        decisions: [humanAnswer('a1')],
        extraEdges: [edge('t2', 't1', 'revises'), edge('a2', 'm4b', 'depends_on')],
        extraNodes: [
          node('m3', 'task', 10, { status: 'resolved', title: 'U3' }),
          node('m4', 'task', 10, { status: 'retired', title: 'U4' }),
          node('t2', 'finding', 40, { title: GOAL_BATCH_TEMPLATE_TITLE }),
          node('a2', 'decision', 41, { title: GOAL_BATCH_ASSAY_TITLE }),
          node('m4b', 'task', 42, { title: 'U4' }),
        ],
        state: { assayNodeId: 'a2', massNodeIds: ['m3', 'm4'], probeNodeIds: ['m4b'] },
      }),
      NOW,
    );
    // Wave 1 (U3–U6) went out under v1; wave 2 (U7–U10) has not gone out — it
    // waits under v2, the latest plan.
    expect(buildBatchModel(graph, 'batch').waveRounds).toEqual([1, 2]);
  });
});

describe('plans and re-opened rows', () => {
  it('finds the round a plan version belongs to', () => {
    const graph = buildGoalGraphView(
      batchSnapshot({
        decisions: [humanAnswer('a1')],
        extraEdges: [edge('t2', 't1', 'revises')],
        extraNodes: [
          node('t2', 'finding', 40, { title: GOAL_BATCH_TEMPLATE_TITLE }),
          node('a2', 'decision', 41, { title: GOAL_BATCH_ASSAY_TITLE }),
        ],
        state: { assayNodeId: 'a2', probeNodeIds: [], templateNodeId: 't2' },
      }),
      NOW,
    );
    expect(findBatchPlan(graph, 't2')?.round.revision).toBe(2);
    expect(findBatchPlan(graph, 'a2')).toBeUndefined();
  });

  it('groups re-opened units by the batch they came from', () => {
    const probe = (nodeId: string, wave: number) => ({
      from: { index: 0, kind: 'wave' as const, wave },
      nodeId,
      state: 'backlog' as const,
      title: nodeId,
    });
    const rows = reopenedRows([probe('a', 2), probe('b', 2), probe('c', 3)], 10);
    expect(rows.map((row) => [row.from, row.probes.map((p) => p.nodeId)])).toEqual([
      [{ index: 0, kind: 'wave', wave: 2 }, ['a', 'b']],
      [{ index: 0, kind: 'wave', wave: 3 }, ['c']],
    ]);
  });
});

describe('layoutBatch', () => {
  it('lays the cold start and each round left to right, each break feeding the next round', () => {
    const graph = buildGoalGraphView(
      batchSnapshot({
        decisions: [humanAnswer('a1'), humanAnswer('a2')],
        extraEdges: [
          edge('t2', 't1', 'revises'),
          edge('t3', 't2', 'revises'),
          edge('a2', 'p2b', 'depends_on'),
          edge('a3', 'm7b', 'depends_on'),
          edge('p2b', 'p2', 'derived_from'),
          edge('m7b', 'm7', 'derived_from'),
        ],
        extraNodes: [
          node('m3', 'task', 10, { status: 'resolved', title: 'U3' }),
          node('t2', 'finding', 40, { title: GOAL_BATCH_TEMPLATE_TITLE }),
          node('a2', 'decision', 41, { title: GOAL_BATCH_ASSAY_TITLE }),
          node('p2b', 'task', 42, { status: 'resolved', title: 'U2' }),
          // U7 opens the roster's second wave, released under v2 — then broke.
          node('m7', 'task', 50, { status: 'retired', title: 'U7' }),
          node('t3', 'finding', 60, { title: GOAL_BATCH_TEMPLATE_TITLE }),
          node('a3', 'decision', 61, { title: GOAL_BATCH_ASSAY_TITLE }),
          node('m7b', 'task', 62, { title: 'U7' }),
        ],
        state: { assayNodeId: 'a3', massNodeIds: ['m3', 'm7'], probeNodeIds: ['m7b'] },
      }),
      NOW,
    );
    const model = buildBatchModel(graph, 'batch');
    const layout = layoutBatch(graph, model);
    const cold = layout.boxes[batchGroupId('batch', 'experimentProbe')];
    const [r1, r2, r3] = [1, 2, 3].map((r) => layout.boxes[batchGroupId('batch', 'round', r)]);

    // One row, left to right, top-aligned: cold start, then round 1, 2, 3.
    expect([cold, r1, r2, r3].map((box) => box.y)).toEqual([0, 0, 0, 0]);
    expect(cold.x + cold.width).toBeLessThan(r1.x);
    expect(r1.x + r1.width).toBeLessThan(r2.x);
    expect(r2.x + r2.width).toBeLessThan(r3.x);
    // Each round feeds the next — the break at v2's gate revises into v3 —
    // and only the hand-offs after a break carry the "revise" label.
    expect(layout.edges.map((e) => [e.source, e.target, e.label])).toEqual([
      [batchGroupId('batch', 'experimentProbe'), batchGroupId('batch', 'round', 1), undefined],
      [batchGroupId('batch', 'round', 1), batchGroupId('batch', 'round', 2), 'revise'],
      [batchGroupId('batch', 'round', 2), batchGroupId('batch', 'round', 3), 'revise'],
    ]);
    // Plans and gates live inside their round; nothing lands as a loose card.
    expect([...layout.nodeIds]).toEqual([]);
    // Links into the batch land on the cold start, lined up under the problem.
    expect(layout.entryId).toBe(batchGroupId('batch', 'experimentProbe'));
    expect(layout.anchorX).toBe(cold.x + cold.width / 2);
    // The re-opened unit is named by the batch it first ran in.
    expect(model.rounds[2].probes[0].from).toEqual({ index: 0, kind: 'wave', wave: 1 });
  });
});
