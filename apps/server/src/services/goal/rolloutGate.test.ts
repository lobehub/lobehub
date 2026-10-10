import type { GoalGraphNode, GoalGraphSnapshot, GoalRolloutState } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { evaluateRolloutGate } from './rolloutGate';

const node = (id: string, overrides: Partial<GoalGraphNode> = {}): GoalGraphNode =>
  ({
    createdAt: new Date(1000),
    description: id,
    id,
    kind: 'task',
    priority: 0,
    status: 'resolved',
    taskId: null,
    title: id,
    ...overrides,
  }) as GoalGraphNode;

const graph = (nodes: GoalGraphNode[]): Pick<GoalGraphSnapshot, 'edges' | 'nodes'> => ({
  edges: nodes
    .filter((item) => item.id !== 'batch')
    .map((item) => ({
      id: `e-${item.id}`,
      kind: 'contains',
      sourceNodeId: 'batch',
      targetNodeId: item.id,
    })) as GoalGraphSnapshot['edges'],
  nodes: [node('batch', { description: 'recipe', kind: 'batch', status: 'active' }), ...nodes],
});

const state = (overrides: Partial<GoalRolloutState> = {}): GoalRolloutState => ({
  batchNodeId: 'batch',
  assayNodeId: 'assay',
  phase: 'probe',
  probeNodeIds: ['probe'],
  releasedCount: 1,
  templateNodeId: 'template',
  templateRevision: 1,
  unitTitles: ['probe', 'rest'],
  waveIndex: 0,
  ...overrides,
});

describe('evaluateRolloutGate', () => {
  it('passes when the probes settled and the template is complete', () => {
    const result = evaluateRolloutGate({
      graph: graph([node('probe'), node('template', { description: 'recipe', kind: 'finding' })]),
      policy: { trigger: 'canary' },
      state: state(),
    });
    expect(result.met).toBe(true);
    expect(result.blockers).toEqual([]);
    // R3: the probe wave alone is provisional, never proof of the class.
    expect(result.provisional).toBe(true);
  });

  it('reports every condition it judged, passed or not, with the nodes behind it', () => {
    const result = evaluateRolloutGate({
      graph: graph([
        node('probe', { status: 'rejected' }),
        node('template', { description: 'recipe', kind: 'finding' }),
      ]),
      policy: {
        spec: { repeatable: true, variantAxes: [{ axis: 'mode', values: ['probe'] }] },
        trigger: 'canary',
      },
      state: state(),
    });
    expect(result.checks).toEqual([
      { count: 1, key: 'units_settled', passed: true, total: 1 },
      { count: 0, key: 'units_succeeded', nodeIds: ['probe'], passed: false, total: 1 },
      { key: 'no_open_decision', passed: true },
      { key: 'plan_written', nodeIds: ['template'], passed: true },
      { key: 'axes_covered', passed: true },
    ]);
  });

  it('is no longer provisional once a later wave has run', () => {
    const result = evaluateRolloutGate({
      graph: graph([node('probe'), node('template', { description: 'recipe', kind: 'finding' })]),
      policy: { trigger: 'canary' },
      state: state({ waveIndex: 1 }),
    });
    expect(result.provisional).toBe(false);
  });

  it('blocks while a probe has not settled', () => {
    const result = evaluateRolloutGate({
      graph: graph([
        node('probe', { status: 'active' }),
        node('template', { description: 'recipe', kind: 'finding' }),
      ]),
      policy: { trigger: 'canary' },
      state: state(),
    });
    expect(result.met).toBe(false);
    expect(result.blockers.join(' ')).toContain('have not settled');
  });

  it('blocks when a probe was rejected — a person must look', () => {
    const result = evaluateRolloutGate({
      graph: graph([
        node('probe', { status: 'rejected' }),
        node('template', { description: 'recipe', kind: 'finding' }),
      ]),
      policy: { trigger: 'canary' },
      state: state(),
    });
    expect(result.met).toBe(false);
    expect(result.blockers.join(' ')).toContain('did not succeed');
  });

  it('blocks when the template is incomplete', () => {
    const result = evaluateRolloutGate({
      graph: graph([node('probe'), node('template', { description: '', kind: 'finding' })]),
      policy: { trigger: 'canary' },
      state: state(),
    });
    expect(result.met).toBe(false);
    expect(result.blockers.join(' ')).toContain('template is incomplete');
  });

  it('blocks an open human decision inside the batch', () => {
    const result = evaluateRolloutGate({
      graph: graph([
        node('probe'),
        node('template', { description: 'recipe', kind: 'finding' }),
        node('assay', { kind: 'decision', status: 'waiting' }),
      ]),
      policy: { trigger: 'canary' },
      state: state(),
    });
    expect(result.met).toBe(false);
    expect(result.blockers.join(' ')).toContain('human decision');
  });

  it('requires the declared external checks before it can pass (R1)', () => {
    const policy = {
      gate: { externalChecks: [{ check: 'ci', title: 'CI green' }] },
      trigger: 'canary' as const,
    };
    const graphWithProbe = graph([
      node('probe'),
      node('template', { description: 'recipe', kind: 'finding' }),
    ]);

    expect(
      evaluateRolloutGate({ graph: graphWithProbe, policy, state: state() }).blockers.join(' '),
    ).toContain('have not been evaluated');

    expect(
      evaluateRolloutGate({
        externalChecks: [{ passed: false, title: 'CI green' }],
        graph: graphWithProbe,
        policy,
        state: state(),
      }).met,
    ).toBe(false);

    expect(
      evaluateRolloutGate({
        externalChecks: [{ passed: true, title: 'CI green' }],
        graph: graphWithProbe,
        policy,
        state: state(),
      }).met,
    ).toBe(true);
  });

  it('blocks an untested variant axis (R4)', () => {
    const result = evaluateRolloutGate({
      graph: graph([
        node('probe', { description: 'no cold start here', title: 'probe' }),
        node('template', { description: 'recipe', kind: 'finding' }),
      ]),
      policy: {
        spec: { repeatable: true, variantAxes: [{ axis: 'cold-start', values: ['yes'] }] },
        trigger: 'canary',
      },
      state: state(),
    });
    expect(result.met).toBe(false);
    expect(result.blockers.join(' ')).toContain('untested axes');
  });
});
