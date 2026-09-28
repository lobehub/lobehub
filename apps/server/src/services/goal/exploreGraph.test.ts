import type { GoalGraphSnapshot } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { exploreGraph } from './exploreGraph';

const { plan, claim, apply } = vi.hoisted(() => ({
  apply: vi.fn(),
  claim: vi.fn(),
  plan: vi.fn(),
}));
vi.mock('@/database/models/goalExploration', () => ({
  GoalExplorationModel: vi.fn(function () {
    return { apply, claim, fail: vi.fn() };
  }),
  goalExplorationSnapshot: () => 'snapshot',
}));
vi.mock('./explorationPlanner', () => ({
  GoalExplorationPlanner: vi.fn(function () {
    return { plan };
  }),
}));

const node = (id: string, kind: string, status = 'resolved') =>
  ({ description: null, id, kind, status, title: id }) as any;

const graph = (edges: any[] = []): GoalGraphSnapshot =>
  ({
    decisions: [],
    edges,
    events: [],
    goal: {
      config: { exploration: { instruction: 'search', maxExperiments: 5 } },
      id: 'goal_1',
      requirement: 'Answer the question',
      title: 'Goal',
    },
    nodes: [node('parent', 'experiment'), node('child', 'experiment')],
    workVersions: [],
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  claim.mockResolvedValue({ token: 'token' });
  plan.mockResolvedValue({
    action: 'verify',
    instruction: '',
    parentNodeId: '',
    reason: 'done',
    title: '',
  });
  apply.mockResolvedValue({ outcome: 'verify' });
});

describe('exploreGraph', () => {
  it('tells the planner which experiments a previous turn derived, and from what', async () => {
    await exploreGraph({
      db: {} as LobeChatDatabase,
      effects: [],
      graph: graph([{ kind: 'derived_from', sourceNodeId: 'child', targetNodeId: 'parent' }]),
      userId: 'user',
    });
    const experiments = plan.mock.calls[0][0].experiments;
    expect(experiments.find((item: any) => item.id === 'child').derivedFromId).toBe('parent');
    expect(experiments.find((item: any) => item.id === 'parent').derivedFromId).toBeUndefined();
  });

  it('folds a correction’s results into the experiment it corrected', async () => {
    const withCorrection = {
      ...graph(),
      edges: [{ kind: 'revises', sourceNodeId: 'fix', targetNodeId: 'parent' }],
      nodes: [
        node('parent', 'experiment'),
        { ...node('fix', 'task'), description: null },
        { ...node('rerun-result', 'finding'), description: 'AUC 0.71 on the same holdout' },
      ],
    } as any;
    withCorrection.edges.push({
      kind: 'produces',
      sourceNodeId: 'fix',
      targetNodeId: 'rerun-result',
    });
    await exploreGraph({
      db: {} as LobeChatDatabase,
      effects: [],
      graph: withCorrection,
      userId: 'user',
    });
    const parent = plan.mock.calls[0][0].experiments.find((item: any) => item.id === 'parent');
    // Without this the next turn reads only the pre-correction evidence.
    expect(parent.results.join('\n')).toContain('AUC 0.71');
    expect(parent.revisionsRemaining).toBe(1);
  });

  it('reports the park instead of replanning when an allowance is spent', async () => {
    plan.mockResolvedValue({
      action: 'revise',
      instruction: 'Try once more',
      parentNodeId: 'parent',
      reason: 'Still not measuring the right thing',
      title: '',
    });
    apply.mockResolvedValue({ outcome: 'revision-limit', reason: 'allowance spent' });
    const effects: any[] = [];
    const result = await exploreGraph({
      db: {} as LobeChatDatabase,
      effects,
      graph: graph(),
      userId: 'user',
    });
    // `advanced` here would replan on identical input and burn the tick budget.
    expect(result).toMatchObject({ message: 'allowance spent', outcome: 'no_progress' });
    expect(effects).toContainEqual(
      expect.objectContaining({ detail: 'paused: revision allowance spent' }),
    );
  });

  it('reports a revision as its own advance so the corrected protocol is dispatched', async () => {
    plan.mockResolvedValue({
      action: 'revise',
      instruction: 'Report AUC instead of a verdict',
      parentNodeId: 'parent',
      reason: 'The verdict discarded the ranking signal',
      title: '',
    });
    apply.mockResolvedValue({ nodeId: 'retry', outcome: 'revised', parentNodeId: 'parent' });
    const effects: any[] = [];
    const result = await exploreGraph({
      db: {} as LobeChatDatabase,
      effects,
      graph: graph(),
      userId: 'user',
    });
    expect(result).toMatchObject({ nodeId: 'retry', outcome: 'advanced' });
    expect(effects).toContainEqual(
      expect.objectContaining({
        detail: 'revised parent: The verdict discarded the ranking signal',
        type: 'created_node',
      }),
    );
  });
});
