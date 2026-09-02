// @vitest-environment node
import { GOAL_COORDINATOR_ACTOR_ID } from '@lobechat/const/goal';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, goalNodes, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalGraphModel } from '../goalGraph';
import { TaskModel } from '../task';
import { WorkModel } from '../work';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-graph-test-user';
const otherUserId = 'goal-graph-other-user';

const goalModel = new GoalModel(serverDB, userId);
const graphModel = new GoalGraphModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('GoalGraphModel', () => {
  it('creates nodes and edges with an atomic event trail', async () => {
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Reproduce Ornith' });
    const problem = await graphModel.createNode(goal.id, {
      kind: 'problem',
      title: 'Can the published specification reproduce the system?',
    });
    const work = await graphModel.createNode(goal.id, {
      kind: 'task',
      title: 'Implement the minimal training loop',
    });

    const edge = await graphModel.createEdge(goal.id, problem!.id, work!.id, 'leads_to');
    const graph = await graphModel.getGraph(goal.id);

    expect(edge).toMatchObject({ goalId: goal.id, kind: 'leads_to' });
    expect(graph?.nodes).toHaveLength(2);
    expect(graph?.edges).toHaveLength(1);
    // Newest first — getGraph bounds and orders the trail for the polling UI.
    expect(graph?.events.map((event) => event.eventType)).toEqual(['linked', 'created', 'created']);
  });

  it('records who made each transition', async () => {
    // Every event used to be attributed to the goal's owner, because the model
    // falls back to its `userId` — which made a move the coordinator decided on
    // its own indistinguishable from one a person made.
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Attributed' });
    const coordinator = new GoalGraphModel(serverDB, userId, undefined, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    });

    const byUser = await graphModel.createNode(goal.id, { kind: 'task', title: 'Asked for' });
    const bySystem = await coordinator.createNode(goal.id, { kind: 'finding', title: 'Concluded' });
    await serverDB.insert(agents).values({ id: 'agt_author', slug: 'agt-author', userId });
    const byAgent = await coordinator.createNode(goal.id, {
      createdByAgentId: 'agt_author',
      kind: 'finding',
      title: 'Written by an agent',
    });

    const { events } = (await graphModel.getGraph(goal.id))!;
    const actorOf = (nodeId: string) => {
      const event = events.find((item) => item.entityId === nodeId);
      return { actorId: event?.actorId, actorType: event?.actorType };
    };

    expect(actorOf(byUser!.id)).toEqual({ actorId: userId, actorType: 'user' });
    expect(actorOf(bySystem!.id)).toEqual({
      actorId: GOAL_COORDINATOR_ACTOR_ID,
      actorType: 'system',
    });
    // An explicit agent author still wins over the instance actor.
    expect(actorOf(byAgent!.id)).toEqual({ actorId: 'agt_author', actorType: 'agent' });
  });

  it('creates a synthesized node only once when coordinators race', async () => {
    const goal = await goalModel.create({
      subjectType: 'standalone',
      title: 'Concurrent synthesis',
    });
    const input = { kind: 'task' as const, title: 'Complete full Goal acceptance' };

    const results = await Promise.all([
      graphModel.createNodeOnce(goal.id, input),
      graphModel.createNodeOnce(goal.id, input),
    ]);
    const graph = await graphModel.getGraph(goal.id);

    expect(results.filter((result) => result?.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result?.node.id))).toHaveLength(1);
    expect(graph?.nodes).toHaveLength(1);
    expect(graph?.events).toHaveLength(1);
  });

  it('creates and resolves a durable human decision', async () => {
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Decision goal' });
    const node = await graphModel.createNode(goal.id, {
      kind: 'decision',
      title: 'Choose verifier',
    });
    const decision = await graphModel.createDecision(goal.id, node!.id, {
      authority: 'user',
      options: [
        { id: 'harden', label: 'Harden verifier' },
        { id: 'continue', label: 'Continue training' },
      ],
      question: 'Which branch should run next?',
      recommendedOptionId: 'harden',
    });

    const resolved = await graphModel.resolveDecision(
      goal.id,
      decision!.id,
      'harden',
      'Safer first',
    );
    const graph = await graphModel.getGraph(goal.id);

    expect(resolved).toMatchObject({ resolvedOptionId: 'harden', status: 'resolved' });
    expect(graph?.nodes[0]).toMatchObject({ status: 'resolved' });
    expect(graph?.decisions[0]).toMatchObject({ resolution: 'Safer first', status: 'resolved' });
  });

  it('allows only one concurrent resolution of a pending decision', async () => {
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Decision race' });
    const node = await graphModel.createNode(goal.id, {
      kind: 'decision',
      title: 'Choose once',
    });
    const decision = await graphModel.createDecision(goal.id, node!.id, {
      authority: 'user',
      options: [
        { id: 'retry', label: 'Retry' },
        { id: 'retire', label: 'Retire' },
      ],
      question: 'Which outcome wins?',
    });

    const results = await Promise.all([
      graphModel.resolveDecision(goal.id, decision!.id, 'retry'),
      graphModel.resolveDecision(goal.id, decision!.id, 'retire'),
    ]);
    const graph = await graphModel.getGraph(goal.id);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(graph?.events.filter((event) => event.eventType === 'resolved')).toHaveLength(1);
    expect(graph?.decisions[0].resolvedOptionId).toBe(results.find(Boolean)!.resolvedOptionId);
  });

  it('allows only one task binding for a work node', async () => {
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Task binding race' });
    const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'Run once' });
    const taskModel = new TaskModel(serverDB, userId);
    const [firstTask, secondTask] = await Promise.all([
      taskModel.create({ instruction: 'First candidate' }),
      taskModel.create({ instruction: 'Second candidate' }),
    ]);

    expect(await graphModel.claimTaskNode(goal.id, node!.id, new Date(0))).toBeDefined();
    const bindings = await Promise.all([
      graphModel.bindTask(goal.id, node!.id, firstTask.id),
      graphModel.bindTask(goal.id, node!.id, secondTask.id),
    ]);
    const graph = await graphModel.getGraph(goal.id);

    expect(bindings.filter(Boolean)).toHaveLength(1);
    expect(graph?.nodes[0].taskId).toBe(bindings.find(Boolean)!.taskId);
    expect(graph?.events.filter((event) => event.entityType === 'task')).toHaveLength(1);
  });

  it('refuses to bind a task to a node that is not a task node', async () => {
    // This used to be a CHECK constraint. It lives in `bindTask`'s WHERE now,
    // so the rule needs a test on the write path or nothing enforces it.
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Wrong kind' });
    const finding = await graphModel.createNode(goal.id, { kind: 'finding', title: 'A finding' });
    const task = await new TaskModel(serverDB, userId).create({ instruction: 'Should not bind' });

    expect(await graphModel.bindTask(goal.id, finding!.id, task.id)).toBeUndefined();
    expect((await graphModel.getGraph(goal.id))?.nodes[0].taskId).toBeNull();
  });

  it('allows an abandoned work claim to be recovered after its lease expires', async () => {
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Recover claim' });
    const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'Recoverable work' });

    expect(await graphModel.claimTaskNode(goal.id, node!.id, new Date(0))).toBeDefined();
    expect(await graphModel.claimTaskNode(goal.id, node!.id, new Date(0))).toBeUndefined();

    await serverDB
      .update(goalNodes)
      .set({ updatedAt: new Date('2020-01-01') })
      .where(eq(goalNodes.id, node!.id));

    expect(await graphModel.claimTaskNode(goal.id, node!.id, new Date('2021-01-01'))).toBeDefined();
  });

  it('pins an immutable Work version to an owned graph node', async () => {
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Evidence goal' });
    const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'Produce evidence' });
    const task = await new TaskModel(serverDB, userId).create({ instruction: 'Produce evidence' });
    const work = await new WorkModel(serverDB, userId).registerTask({
      changeType: 'created',
      taskId: task.id,
      toolIdentifier: 'goal-test',
      toolName: 'createTask',
    });

    const link = await graphModel.attachWorkVersion(
      goal.id,
      node!.id,
      work!.currentVersionId!,
      'produced',
    );

    expect(link).toMatchObject({ nodeId: node!.id, relation: 'produced' });
    expect((await graphModel.getGraph(goal.id))?.workVersions).toHaveLength(1);
  });

  it('does not expose or mutate another user graph', async () => {
    const otherGoalModel = new GoalModel(serverDB, otherUserId);
    const otherGraphModel = new GoalGraphModel(serverDB, otherUserId);
    const goal = await otherGoalModel.create({ subjectType: 'standalone', title: 'Private graph' });
    const node = await otherGraphModel.createNode(goal.id, { kind: 'task', title: 'Private work' });

    expect(await graphModel.getGraph(goal.id)).toBeUndefined();
    expect(await graphModel.updateNodeStatus(goal.id, node!.id, 'resolved')).toBeUndefined();

    const graph = await otherGraphModel.getGraph(goal.id);
    expect(graph?.nodes[0].status).toBe('proposed');
    expect(graph?.events).toHaveLength(1);
  });

  it('caps the events a graph read carries, newest first', async () => {
    // The detail page polls getGraph every few seconds; without a limit a
    // long-horizon goal's payload grew linearly with its age.
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Noisy graph' });
    const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'Churn' });
    for (let i = 0; i < GoalGraphModel.GRAPH_EVENT_LIMIT + 5; i++) {
      await graphModel.updateNodeStatus(goal.id, node!.id, i % 2 ? 'active' : 'waiting');
    }

    const graph = await graphModel.getGraph(goal.id);

    expect(graph?.events).toHaveLength(GoalGraphModel.GRAPH_EVENT_LIMIT);
    const createdAt = graph!.events.map((event) => event.createdAt.getTime());
    expect([...createdAt].sort((a, b) => b - a)).toEqual(createdAt);
    expect(graph!.events[0].eventType).toBe('updated');
  });

  it('records a goal-level status transition as a system-attributed event', async () => {
    // The lifecycle event types existed in the schema but nothing wrote them,
    // so a goal's planning → running → paused path left no trace at all.
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Status trail' });
    const coordinator = new GoalGraphModel(serverDB, userId, undefined, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    });

    await coordinator.recordGoalStatus(goal.id, 'planning', 'running');
    await coordinator.recordGoalStatus(goal.id, 'running', 'paused', 'nothing ready');
    // A same-status write is a no-op — re-stamping would flood the timeline.
    await coordinator.recordGoalStatus(goal.id, 'paused', 'paused');

    const events = (await graphModel.getGraph(goal.id))!.events.filter(
      (event) => event.entityType === 'goal',
    );

    expect(events).toHaveLength(2);
    // Newest first: [1] is the earlier activation, [0] the later pause.
    expect(events[1]).toMatchObject({
      actorId: GOAL_COORDINATOR_ACTOR_ID,
      actorType: 'system',
      entityId: goal.id,
      eventType: 'activated',
      reason: 'status planning → running',
    });
    expect(events[0]).toMatchObject({
      eventType: 'updated',
      reason: 'nothing ready',
    });
  });
});
