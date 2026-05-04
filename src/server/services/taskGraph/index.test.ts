import { describe, expect, it } from 'vitest';

import { planSubtaskLayers, type SubtaskNode } from './index';

const node = (identifier: string, status: string, dependsOn: string[] = []): SubtaskNode => ({
  dependsOn,
  identifier,
  status,
});

describe('planSubtaskLayers', () => {
  it('returns an empty plan when there are no nodes', () => {
    const plan = planSubtaskLayers([]);
    expect(plan.layers).toEqual([]);
    expect(plan.totalRunnable).toBe(0);
    expect(plan.cycles).toEqual([]);
  });

  it('puts independent runnable tasks into a single layer', () => {
    const plan = planSubtaskLayers([
      node('T-1', 'backlog'),
      node('T-2', 'backlog'),
      node('T-3', 'backlog'),
    ]);
    expect(plan.layers).toEqual([['T-1', 'T-2', 'T-3']]);
    expect(plan.totalRunnable).toBe(3);
  });

  it('respects a linear dependency chain', () => {
    const plan = planSubtaskLayers([
      node('T-1', 'backlog'),
      node('T-2', 'backlog', ['T-1']),
      node('T-3', 'backlog', ['T-2']),
    ]);
    expect(plan.layers).toEqual([['T-1'], ['T-2'], ['T-3']]);
  });

  it('groups diamond dependencies into the right layers', () => {
    const plan = planSubtaskLayers([
      node('T-1', 'backlog'),
      node('T-2', 'backlog', ['T-1']),
      node('T-3', 'backlog', ['T-1']),
      node('T-4', 'backlog', ['T-2', 'T-3']),
    ]);
    expect(plan.layers).toEqual([['T-1'], ['T-2', 'T-3'], ['T-4']]);
  });

  it('skips already-completed tasks and treats their dependents as roots', () => {
    const plan = planSubtaskLayers([
      node('T-1', 'completed'),
      node('T-2', 'backlog', ['T-1']),
      node('T-3', 'backlog', ['T-2']),
    ]);
    expect(plan.layers).toEqual([['T-2'], ['T-3']]);
    expect(plan.alreadyDone).toEqual(['T-1']);
  });

  it('marks running / scheduled tasks as ineligible (not in layers)', () => {
    const plan = planSubtaskLayers([
      node('T-1', 'running'),
      node('T-2', 'backlog'),
      node('T-3', 'scheduled'),
    ]);
    expect(plan.layers).toEqual([['T-2']]);
    expect(plan.ineligible.sort()).toEqual(['T-1', 'T-3']);
  });

  it('treats failed and paused as runnable (allows re-run)', () => {
    const plan = planSubtaskLayers([node('T-1', 'failed'), node('T-2', 'paused', ['T-1'])]);
    expect(plan.layers).toEqual([['T-1'], ['T-2']]);
  });

  it('detects a simple two-node cycle', () => {
    const plan = planSubtaskLayers([
      node('T-1', 'backlog', ['T-2']),
      node('T-2', 'backlog', ['T-1']),
    ]);
    expect(plan.layers).toEqual([]);
    expect(plan.cycles.sort()).toEqual(['T-1', 'T-2']);
  });

  it('separates nodes blocked by a cycle from cycle members', () => {
    const plan = planSubtaskLayers([
      node('T-1', 'backlog', ['T-2']),
      node('T-2', 'backlog', ['T-1']),
      node('T-3', 'backlog', ['T-1']),
    ]);
    expect(plan.cycles.sort()).toEqual(['T-1', 'T-2']);
    expect(plan.blockedByCycle).toEqual(['T-3']);
    expect(plan.layers).toEqual([]);
  });

  it('still places acyclic branches when other branches contain cycles', () => {
    const plan = planSubtaskLayers([
      node('A', 'backlog', ['B']),
      node('B', 'backlog', ['A']),
      node('C', 'backlog'),
      node('D', 'backlog', ['C']),
    ]);
    expect(plan.layers).toEqual([['C'], ['D']]);
    expect(plan.cycles.sort()).toEqual(['A', 'B']);
  });

  it('drops dependency edges to canceled upstreams (treated as already done)', () => {
    const plan = planSubtaskLayers([node('T-1', 'canceled'), node('T-2', 'backlog', ['T-1'])]);
    expect(plan.layers).toEqual([['T-2']]);
    expect(plan.alreadyDone).toEqual(['T-1']);
  });
});
