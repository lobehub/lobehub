// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { GoalModel } from './goal';
import { GoalExplorationModel, goalExplorationSnapshot } from './goalExploration';
import { GoalGraphModel } from './goalGraph';

const db: LobeChatDatabase = await getTestDB();

const userId = 'exploration-guards-owner';
const graphModel = new GoalGraphModel(db, userId);
const model = new GoalExplorationModel(db, userId);

type NodeKind = Parameters<GoalGraphModel['createNode']>[1]['kind'];

/**
 * Makes the graph model each `apply` builds on its transaction answer `createNode` with
 * `undefined` — its "this goal is no longer yours" result — for nodes of `lostKind`, the
 * answer a goal that left the caller's ownership after `lock()` would produce. Other kinds
 * are created for real on the same transaction.
 */
const loseCreateNodeFor = (lostKind: NodeKind) => {
  const buildGraph = (GoalExplorationModel.prototype as any).graph as (
    tx: LobeChatDatabase,
  ) => GoalGraphModel;
  vi.spyOn(GoalExplorationModel.prototype as any, 'graph').mockImplementation(function (
    this: GoalExplorationModel,
    tx: unknown,
  ) {
    const graph = buildGraph.call(this, tx as LobeChatDatabase);
    const createNode = graph.createNode;
    vi.spyOn(graph, 'createNode').mockImplementation(async (goalId, input) =>
      input.kind === lostKind ? undefined : createNode(goalId, input),
    );
    return graph;
  });
};

async function seed() {
  const goal = await new GoalModel(db, userId).create({
    config: { exploration: { instruction: 'Compare results', maxExperiments: 3 } },
    status: 'running',
    subjectType: 'standalone',
    title: 'Explore candidates',
  });
  await graphModel.createNode(goal.id, { kind: 'problem', title: 'Find a candidate' });
  const parent = await graphModel.createNode(goal.id, {
    kind: 'task',
    status: 'resolved',
    title: 'Baseline',
  });
  return { goalId: goal.id, parent: parent! };
}

async function seedExperiment(goalId: string) {
  const graph = (await graphModel.getGraph(goalId))!;
  const experiment = await graphModel.createNode(goalId, {
    kind: 'experiment',
    questionId: graph.nodes.find((node) => node.kind === 'problem')!.id,
    title: 'Three arms',
  });
  await graphModel.createNode(goalId, {
    kind: 'task',
    scopeId: experiment!.id,
    status: 'resolved',
    title: 'Three arms run 1',
  });
  return experiment!.id;
}

async function claim(goalId: string) {
  return (await model.claim(goalId, goalExplorationSnapshot((await graphModel.getGraph(goalId))!)))!
    .token;
}

const nodeIds = async (goalId: string) =>
  (await graphModel.getGraph(goalId))!.nodes.map((node) => node.id).sort();

const expand = (parentNodeId: string) => ({
  action: 'expand' as const,
  instruction: 'Change the baseline using its evidence',
  parentNodeId,
  reason: 'The first result is promising',
  title: 'Alternative',
});

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(users).where(inArray(users.id, [userId]));
});

describe('GoalExplorationModel.apply createNode guards', () => {
  it('aborts a revision whose corrected protocol could not be persisted', async () => {
    const { goalId } = await seed();
    const experimentId = await seedExperiment(goalId);
    const token = await claim(goalId);
    const before = await nodeIds(goalId);
    loseCreateNodeFor('task');

    await expect(
      model.apply(goalId, token, {
        action: 'revise',
        instruction: 'Emit a calibrated score, then report AUC',
        parentNodeId: experimentId,
        reason: 'The arms measured a hard verdict',
        title: '',
      }),
    ).rejects.toThrow('Could not persist the revised protocol');

    vi.restoreAllMocks();
    const graph = (await graphModel.getGraph(goalId))!;
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(before);
    expect(graph.edges.filter((edge) => edge.kind === 'revises')).toEqual([]);
  });

  it('aborts an expansion whose experiment container could not be created', async () => {
    const { goalId, parent } = await seed();
    const token = await claim(goalId);
    const before = await nodeIds(goalId);
    loseCreateNodeFor('experiment');

    await expect(model.apply(goalId, token, expand(parent.id))).rejects.toThrow(
      'Could not create experiment',
    );

    vi.restoreAllMocks();
    expect(await nodeIds(goalId)).toEqual(before);
  });

  it('rolls back the new experiment when its first protocol could not be persisted', async () => {
    const { goalId, parent } = await seed();
    const token = await claim(goalId);
    const before = await nodeIds(goalId);
    loseCreateNodeFor('task');

    await expect(model.apply(goalId, token, expand(parent.id))).rejects.toThrow(
      'Could not persist exploration node',
    );

    vi.restoreAllMocks();
    // The experiment was inserted on the same transaction; the throw takes it back out.
    const graph = (await graphModel.getGraph(goalId))!;
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(before);
    expect(graph.nodes.filter((node) => node.kind === 'experiment')).toEqual([]);
    expect(graph.edges.filter((edge) => edge.kind === 'derived_from')).toEqual([]);
  });
});
