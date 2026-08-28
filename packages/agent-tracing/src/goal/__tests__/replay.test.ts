import { describe, expect, it } from 'vitest';

import { type GoalDecider, replayTrajectory } from '../replay';
import type { GoalTickSnapshot, GoalTrajectory } from '../types';
import { graph, node } from './fixtures';

const tick = (overrides: Partial<GoalTickSnapshot> = {}): GoalTickSnapshot => ({
  at: 1000,
  branch: 'dispatch_task',
  budget: { costLimitReached: false, roundLimitReached: false, runs: 0, totalCost: 0 },
  candidates: [
    { blockedBy: [], nodeId: 'a', priority: 1, status: 'proposed', title: 'a' },
    { blockedBy: [], nodeId: 'b', priority: 0, status: 'proposed', title: 'b' },
  ],
  chosenNodeId: 'a',
  graphShape: {
    edgesTotal: 0,
    findings: 0,
    gatesPending: 0,
    nodesTotal: 2,
    workBlocked: 0,
    workOpen: 2,
    workReady: 2,
    workResolved: 0,
  },
  index: 0,
  message: '',
  outcome: 'advanced',
  ...overrides,
});

const trajectory: GoalTrajectory = {
  advances: [
    {
      completedAt: 5,
      durationMs: 5,
      effects: [],
      seq: 0,
      startedAt: 0,
      ticks: [tick()],
      trigger: 'create',
    },
  ],
  goalId: 'goal_1',
  graphBaseline: graph({ nodes: [node('a', { priority: 1 }), node('b')] }),
  startedAt: 0,
  title: 'Reproduce nanoGPT',
  totalAdvances: 1,
  totalTicks: 1,
  traceId: 'goal_1',
};

/** Ranks the same way the recorded run did: priority desc, then creation order. */
const faithful: GoalDecider = ({ graph: state }) => {
  const candidates = state.nodes
    .filter((item) => item.kind === 'work')
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
    .map((item) => ({
      blockedBy: [],
      nodeId: item.id,
      priority: item.priority,
      status: item.status,
      title: item.title,
    }));

  return {
    branch: 'dispatch_task',
    candidates,
    chosenNodeId: candidates[0]?.nodeId,
    outcome: 'advanced',
  };
};

describe('replayTrajectory', () => {
  it('reports no divergence when the decider still decides the same way', () => {
    expect(replayTrajectory(trajectory, faithful)).toMatchObject({
      divergences: [],
      matched: 1,
      ticks: 1,
    });
  });

  it('flags a reordered frontier as a candidates divergence', () => {
    const reversed: GoalDecider = (input) => {
      const decision = faithful(input);
      return { ...decision, candidates: [...decision.candidates].reverse() };
    };

    const result = replayTrajectory(trajectory, reversed);

    expect(result.matched).toBe(0);
    expect(result.divergences).toEqual([
      { advanceSeq: 0, field: 'candidates', recorded: 'a,b', replayed: 'b,a', tickIndex: 0 },
    ]);
  });

  it('flags a changed branch and a changed choice separately', () => {
    const different: GoalDecider = (input) => ({
      ...faithful(input),
      branch: 'budget_exhausted',
      chosenNodeId: 'b',
    });

    expect(replayTrajectory(trajectory, different).divergences.map((item) => item.field)).toEqual([
      'branch',
      'chosenNodeId',
    ]);
  });

  it('feeds the decider the graph as it was entering the tick, not the final one', () => {
    const seen: string[] = [];
    replayTrajectory(
      {
        ...trajectory,
        advances: [
          {
            ...trajectory.advances[0],
            ticks: [
              tick(),
              tick({
                graphDelta: { nodesUpserted: [node('c')] },
                index: 1,
              }),
            ],
          },
        ],
      },
      (input) => {
        seen.push(input.graph.nodes.map((item) => item.id).join(','));
        return faithful(input);
      },
    );

    expect(seen).toEqual(['a,b', 'a,b,c']);
  });
});
