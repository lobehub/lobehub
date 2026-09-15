// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { goals, users } from '../../schemas';
import { GoalModel } from '../goal';
import { GoalExplorationModel, goalExplorationSnapshot } from '../goalExploration';
import { GoalGraphModel } from '../goalGraph';
import { TaskModel } from '../task';
import { WorkModel } from '../work';

const db = await getTestDB();
const userId = 'exploration-owner';
const graphModel = new GoalGraphModel(db, userId);
const model = new GoalExplorationModel(db, userId);

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: 'other-owner' }]);
});
afterEach(async () => {
  await db.delete(users);
});

async function seed(maxExperiments = 3) {
  const goal = await new GoalModel(db, userId).create({
    title: 'Explore candidates',
    subjectType: 'standalone',
    status: 'running',
    config: { exploration: { instruction: 'Compare results', maxExperiments } },
  });
  await graphModel.createNode(goal.id, { kind: 'problem', title: 'Find a candidate' });
  const parent = await graphModel.createNode(goal.id, {
    kind: 'task',
    title: 'Baseline',
    status: 'resolved',
  });
  return { goalId: goal.id, parent: parent! };
}
async function claim(goalId: string) {
  return model.claim(goalId, goalExplorationSnapshot((await graphModel.getGraph(goalId))!));
}
const expand = (parentNodeId: string) => ({
  action: 'expand' as const,
  parentNodeId,
  title: 'Alternative',
  instruction: 'Change the baseline using its evidence',
  reason: 'The first result is promising',
});

const revise = (
  parentNodeId: string,
  instruction = 'Emit a calibrated score, then report AUC',
) => ({
  action: 'revise' as const,
  parentNodeId,
  title: '',
  instruction,
  reason: 'The arms measured a hard verdict, which discards the ranking signal',
});

/** A resolved experiment container with one finished protocol and its produced Work. */
async function seedExperiment(goalId: string, title = 'Three arms') {
  const graph = (await graphModel.getGraph(goalId))!;
  const experiment = await graphModel.createNode(goalId, {
    kind: 'experiment',
    questionId: graph.nodes.find((node) => node.kind === 'problem')!.id,
    title,
  });
  const run = await graphModel.createNode(goalId, {
    kind: 'task',
    scopeId: experiment!.id,
    status: 'resolved',
    title: `${title} run 1`,
  });
  const task = await new TaskModel(db, userId).create({ instruction: 'baseline evidence' });
  const work = await new WorkModel(db, userId).registerTask({
    changeType: 'created',
    taskId: task.id,
    toolIdentifier: 'test',
    toolName: 'createTask',
  });
  await graphModel.attachWorkVersion(goalId, run!.id, work!.currentVersionId!, 'produced');
  return { experimentId: experiment!.id, versionId: work!.currentVersionId! };
}

describe('GoalExplorationModel', () => {
  it('reruns a corrected protocol inside the same experiment without spending a slot', async () => {
    const { goalId } = await seed(2);
    const { experimentId, versionId } = await seedExperiment(goalId);
    const result = await model.apply(goalId, (await claim(goalId))!.token, revise(experimentId));
    expect(result.outcome).toBe('revised');
    const graph = (await graphModel.getGraph(goalId))!;
    // No second container: the correction lives beside the protocol it replaces.
    expect(graph.nodes.filter((node) => node.kind === 'experiment')).toHaveLength(1);
    const revised = graph.nodes.find((node) => node.id === result.nodeId)!;
    expect(revised.kind).toBe('task');
    expect(revised.description).toBe('Emit a calibrated score, then report AUC');
    expect(graph.workVersions).toContainEqual(
      expect.objectContaining({
        nodeId: result.nodeId,
        relation: 'input',
        workVersionId: versionId,
      }),
    );
    expect(graph.events).toContainEqual(
      expect.objectContaining({
        actorType: 'system',
        reason: `Revised ${experimentId}: The arms measured a hard verdict, which discards the ranking signal`,
      }),
    );
  });

  it('carries an earlier correction’s Work into the next one', async () => {
    const { goalId } = await seed(2);
    const { experimentId } = await seedExperiment(goalId);
    const first = await model.apply(goalId, (await claim(goalId))!.token, revise(experimentId));
    const task = await new TaskModel(db, userId).create({ instruction: 'rerun evidence' });
    const work = await new WorkModel(db, userId).registerTask({
      changeType: 'created',
      taskId: task.id,
      toolIdentifier: 'test',
      toolName: 'createTask',
    });
    await graphModel.attachWorkVersion(goalId, first.nodeId!, work!.currentVersionId!, 'produced');
    await graphModel.updateNodeStatus(goalId, first.nodeId!, 'resolved');
    const second = await model.apply(
      goalId,
      (await claim(goalId))!.token,
      revise(experimentId, 'attempt 3'),
    );
    // Without the correction in scope the second rerun would start from the original
    // protocol's artefacts and never see what the first correction produced.
    expect((await graphModel.getGraph(goalId))!.workVersions).toContainEqual(
      expect.objectContaining({
        nodeId: second.nodeId,
        relation: 'input',
        workVersionId: work!.currentVersionId,
      }),
    );
  }, 20_000);

  it('parks the goal when the planner asks past a spent allowance', async () => {
    const { goalId } = await seed(4);
    const { experimentId } = await seedExperiment(goalId);
    for (const attempt of [1, 2]) {
      const applied = await model.apply(
        goalId,
        (await claim(goalId))!.token,
        revise(experimentId, `attempt ${attempt}`),
      );
      expect(applied.outcome).toBe('revised');
      // An experiment reads as unresolved while a correction is still running, so
      // each rerun must finish before the next correction can target it.
      await graphModel.updateNodeStatus(goalId, applied.nodeId!, 'resolved');
    }
    const spent = await model.apply(goalId, (await claim(goalId))!.token, revise(experimentId));
    expect(spent).toMatchObject({ outcome: 'revision-limit' });
    expect((spent as { reason: string }).reason).toContain('already ran 2 corrected protocols');
    // Leaving it running would let every sweep buy another identical planning call.
    const goal = await new GoalModel(db, userId).findById(goalId);
    expect(goal?.status).toBe('paused');
    expect(goal?.config?.pausedBy).toBe('exploration_revision_limit');
  });

  it('does not charge ordinary branches to the correction budget', async () => {
    const { goalId, parent } = await seed(9);
    const { experimentId } = await seedExperiment(goalId);
    // Ordinary expansions also write `derived_from` edges; counting the edge alone
    // would refuse the very first correction.
    for (const _ of [1, 2])
      expect(
        (await model.apply(goalId, (await claim(goalId))!.token, expand(parent.id))).outcome,
      ).toBe('expanded');
    expect(
      (await model.apply(goalId, (await claim(goalId))!.token, revise(experimentId))).outcome,
    ).toBe('revised');
  });

  it('refuses to correct a seed that has no experiment container', async () => {
    const { goalId, parent } = await seed(9);
    await expect(
      model.apply(goalId, (await claim(goalId))!.token, revise(parent.id)),
    ).rejects.toThrow(/experiment container/);
  });

  it('refuses to revise an experiment that never produced a result', async () => {
    const { goalId } = await seed();
    const unresolved = await graphModel.createNode(goalId, {
      kind: 'task',
      title: 'Still running',
      status: 'active',
    });
    await expect(
      model.apply(goalId, (await claim(goalId))!.token, revise(unresolved!.id)),
    ).rejects.toThrow(/resolved experiment/);
  });
  it('branches from an older experiment and pins its produced version with an auditable reason', async () => {
    const { goalId, parent } = await seed();
    await graphModel.createNode(goalId, {
      kind: 'task',
      title: 'Newer failed candidate',
      status: 'resolved',
    });
    const task = await new TaskModel(db, userId).create({ instruction: 'baseline evidence' });
    const work = await new WorkModel(db, userId).registerTask({
      changeType: 'created',
      taskId: task.id,
      toolIdentifier: 'test',
      toolName: 'createTask',
    });
    await graphModel.attachWorkVersion(goalId, parent.id, work!.currentVersionId!, 'produced');
    const lease = await claim(goalId);
    const result = await model.apply(goalId, lease!.token, expand(parent.id));
    expect(result.outcome).toBe('expanded');
    const graph = (await graphModel.getGraph(goalId))!;
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'derived_from',
        sourceNodeId: result.nodeId,
        targetNodeId: parent.id,
      }),
    );
    expect(graph.workVersions).toContainEqual(
      expect.objectContaining({
        nodeId: result.nodeId,
        relation: 'input',
        workVersionId: work!.currentVersionId,
      }),
    );
    expect(graph.events).toContainEqual(
      expect.objectContaining({
        actorType: 'system',
        reason: `Expanded from ${parent.id}: The first result is promising`,
      }),
    );
    expect((await model.apply(goalId, lease!.token, expand(parent.id))).outcome).toBe('stale');
    expect(
      (await graphModel.getGraph(goalId))!.nodes.filter((n) => n.kind === 'task'),
    ).toHaveLength(3);
  });

  it('leases a single planner when advances race', async () => {
    const { goalId } = await seed();
    const snapshot = goalExplorationSnapshot((await graphModel.getGraph(goalId))!);
    const claims = await Promise.all([
      model.claim(goalId, snapshot),
      model.claim(goalId, snapshot),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('discards a late plan after a human pause or graph edit', async () => {
    const { goalId, parent } = await seed();
    const first = await claim(goalId);
    await graphModel.createNode(goalId, { kind: 'finding', title: 'New evidence' });
    expect((await model.apply(goalId, first!.token, expand(parent.id))).outcome).toBe('stale');
    const second = await claim(goalId);
    await db.update(goals).set({ status: 'paused' }).where(eq(goals.id, goalId));
    expect((await model.apply(goalId, second!.token, expand(parent.id))).outcome).toBe('stale');
    await model.fail(goalId, second!.token, 'late error');
    expect(
      (await graphModel.getGraph(goalId))!.nodes.filter((n) => n.kind === 'task'),
    ).toHaveLength(1);
    expect(await claim(goalId)).toBeUndefined();
  });

  it('parks an exhausted search without claiming achievement', async () => {
    const { goalId, parent } = await seed(1);
    const lease = await claim(goalId);
    expect((await model.apply(goalId, lease!.token, expand(parent.id))).outcome).toBe('limit');
    const graph = (await graphModel.getGraph(goalId))!;
    expect(graph.goal.status).toBe('paused');
    expect(graph.goal.config?.exploration?.checkpoint).toBeUndefined();
    expect(graph.nodes.filter((n) => n.kind === 'task')).toHaveLength(1);
    expect(await claim(goalId)).toBeUndefined();
  });

  it('requests independent acceptance at the cap, never directly marks achieved', async () => {
    const { goalId, parent } = await seed(1);
    const lease = await claim(goalId);
    expect(
      (await model.apply(goalId, lease!.token, { ...expand(parent.id), action: 'verify' })).outcome,
    ).toBe('verify');
    const graph = (await graphModel.getGraph(goalId))!;
    expect(graph.goal.status).toBe('running');
    expect(graph.goal.config?.exploration?.checkpoint).toMatchObject({
      readyForAcceptance: true,
      reviewedNodeIds: [parent.id],
    });
  });

  it('rejects foreign ownership and unresolved or foreign parents atomically', async () => {
    const { goalId } = await seed();
    const snapshot = goalExplorationSnapshot((await graphModel.getGraph(goalId))!);
    expect(
      await new GoalExplorationModel(db, 'other-owner').claim(goalId, snapshot),
    ).toBeUndefined();
    const lease = await claim(goalId);
    await expect(model.apply(goalId, lease!.token, expand('foreign-node'))).rejects.toThrow(
      'resolved experiment',
    );
    expect(
      (await graphModel.getGraph(goalId))!.nodes.filter((n) => n.kind === 'task'),
    ).toHaveLength(1);
  });
});

describe('experiment containers', () => {
  it('persists nested answers with mixed node kinds and enforces ownership, scope and cycles', async () => {
    const { goalId } = await seed();
    const question = await graphModel.createNode(goalId, { kind: 'problem', title: 'Question' });
    const answer = await graphModel.createNode(goalId, {
      kind: 'experiment',
      title: 'Candidate',
      questionId: question!.id,
    });
    const task = await graphModel.createNode(goalId, {
      kind: 'task',
      title: 'Measure',
      scopeId: answer!.id,
      status: 'resolved',
    });
    const subq = await graphModel.createNode(goalId, {
      kind: 'problem',
      title: 'Subquestion',
      scopeId: answer!.id,
    });
    const nested = await graphModel.createNode(goalId, {
      kind: 'experiment',
      title: 'Nested candidate',
      scopeId: answer!.id,
      questionId: subq!.id,
    });
    await graphModel.createNode(goalId, {
      kind: 'finding',
      title: 'Evidence',
      scopeId: answer!.id,
      status: 'resolved',
    });
    await graphModel.createNode(goalId, {
      kind: 'decision',
      title: 'Review',
      scopeId: nested!.id,
      status: 'waiting',
    });
    const graph = (await graphModel.getGraph(goalId))!;
    expect(graph.nodes.find((n) => n.id === answer!.id)?.status).toBe('waiting');
    expect(graph.nodes.find((n) => n.id === answer!.id)?.taskId).toBeNull();
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: nested!.id,
        targetNodeId: subq!.id,
        kind: 'answers',
      }),
    );
    await expect(
      graphModel.createEdge(goalId, nested!.id, answer!.id, 'contains'),
    ).rejects.toThrow();
    await expect(graphModel.createEdge(goalId, nested!.id, task!.id, 'contains')).rejects.toThrow(
      'only one',
    );
    await expect(
      graphModel.createNode(goalId, {
        kind: 'experiment',
        title: 'Wrong scope',
        questionId: subq!.id,
      }),
    ).rejects.toThrow('scope');
    await expect(graphModel.createEdge(goalId, answer!.id, task!.id, 'answers')).rejects.toThrow(
      'question',
    );
    await expect(
      graphModel.createEdge(goalId, answer!.id, question!.id, 'contains'),
    ).rejects.toThrow();
    expect((await graphModel.getGraph(goalId))!.nodes.some((n) => n.title === 'Wrong scope')).toBe(
      false,
    );
    expect(
      await new GoalGraphModel(db, 'other-owner').createNode(goalId, {
        kind: 'task',
        title: 'Foreign',
        scopeId: answer!.id,
      }),
    ).toBeUndefined();
  });
});
