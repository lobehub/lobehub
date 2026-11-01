// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, goalEvents, goalNodes, users, works, workVersions } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalGraphModel } from '../goalGraph';
import { TaskModel } from '../task';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-graph-coverage-user';
const otherUserId = 'goal-graph-coverage-other';

const goalModel = new GoalModel(serverDB, userId);
const graphModel = new GoalGraphModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

const createGoal = (title = 'Coverage goal', createdAt?: Date) =>
  goalModel.create({ createdAt, subjectType: 'standalone', title });

/** A task Work version owned by `ownerId`, with optional version metadata. */
const createWorkVersion = async (ownerId: string, metadata?: Record<string, unknown>) => {
  const [work] = await serverDB
    .insert(works)
    .values({
      resourceType: 'task',
      toolIdentifier: 'lobe-task',
      toolName: 'createTask',
      type: 'task',
      userId: ownerId,
      visibility: 'private',
    })
    .returning();
  const [version] = await serverDB
    .insert(workVersions)
    .values({
      changeType: 'created',
      metadata,
      toolIdentifier: 'lobe-task',
      toolName: 'createTask',
      version: 1,
      workId: work.id,
    })
    .returning();
  return version;
};

describe('GoalGraphModel coverage', () => {
  describe('getGraph work hydration', () => {
    it('carries the agent document a linked version points at', async () => {
      const goal = await createGoal();
      const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'Write doc' });
      const version = await createWorkVersion(userId, { agentDocumentId: 'agent-doc-1' });
      await graphModel.attachWorkVersion(goal.id, node!.id, version.id, 'produced');

      const links = (await graphModel.getGraph(goal.id))?.workVersions;

      expect(links).toHaveLength(1);
      expect(links?.[0].work).toMatchObject({ agentDocumentId: 'agent-doc-1', type: 'task' });
    });
  });

  describe('recordGoalStatus', () => {
    it('maps terminal goal moves and attributes them to the owning user without an actor', async () => {
      const goal = await createGoal();

      await graphModel.recordGoalStatus(goal.id, 'running', 'achieved');
      await graphModel.recordGoalStatus(goal.id, 'running', 'failed', 'gave up');
      await graphModel.recordGoalStatus(goal.id, 'paused', 'canceled');

      const events = await serverDB
        .select()
        .from(goalEvents)
        .where(and(eq(goalEvents.goalId, goal.id), eq(goalEvents.entityType, 'goal')))
        .orderBy(goalEvents.createdAt);

      expect(
        events.map(({ actorId, actorType, eventType, reason }) => ({
          actorId,
          actorType,
          eventType,
          reason,
        })),
      ).toEqual([
        {
          actorId: userId,
          actorType: 'user',
          eventType: 'resolved',
          reason: 'status running → achieved',
        },
        { actorId: userId, actorType: 'user', eventType: 'rejected', reason: 'gave up' },
        {
          actorId: userId,
          actorType: 'user',
          eventType: 'rejected',
          reason: 'status paused → canceled',
        },
      ]);
    });
  });

  describe('attachWorkVersion', () => {
    it('refuses a Work version the viewer does not own', async () => {
      const goal = await createGoal();
      const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'Deliver' });
      const foreign = await createWorkVersion(otherUserId);

      const link = await graphModel.attachWorkVersion(goal.id, node!.id, foreign.id, 'produced');

      expect(link).toBeUndefined();
      expect((await graphModel.getGraph(goal.id))?.workVersions).toEqual([]);
    });

    it('returns undefined and appends no event when the link already exists', async () => {
      const goal = await createGoal();
      const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'Deliver' });
      const version = await createWorkVersion(userId);

      const first = await graphModel.attachWorkVersion(goal.id, node!.id, version.id, 'produced');
      const second = await graphModel.attachWorkVersion(goal.id, node!.id, version.id, 'produced');

      expect(first).toMatchObject({ nodeId: node!.id, relation: 'produced' });
      expect(second).toBeUndefined();
      const attachEvents = await serverDB
        .select()
        .from(goalEvents)
        .where(and(eq(goalEvents.goalId, goal.id), eq(goalEvents.entityId, node!.id)));
      expect(attachEvents.filter((event) => event.eventType === 'updated')).toHaveLength(1);
    });
  });

  describe('countRunningTasks', () => {
    it('reads zero when the count aggregate comes back without a row', async () => {
      const goal = await createGoal();
      const proxied = new GoalGraphModel(
        createProxyTestDB(serverDB, (query, result) =>
          query.includes('count(') ? [] : result.rows,
        ),
        userId,
      );

      expect(await proxied.countRunningTasks(goal.id)).toBe(0);
    });
  });

  describe('findGoalByTaskId', () => {
    it('ranks a node-bound task ahead of a carrier task outside the chain', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const parent = await taskModel.create({ instruction: 'parent task' });
      const task = await taskModel.create({ instruction: 'bound task', parentTaskId: parent.id });
      const elsewhere = await taskModel.create({ instruction: 'unrelated carrier' });
      // Carried by `elsewhere`, which is not on `task`'s ancestor chain, so only the
      // node binding (depth 0) places this goal.
      const goal = await goalModel.create({
        createdAt: new Date('2026-01-01T00:00:00Z'),
        subjectId: elsewhere.id,
        subjectType: 'task',
        title: 'Carried elsewhere',
      });
      const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'Bound' });
      await graphModel.bindTask(goal.id, node!.id, task.id);
      // A newer goal carried by the parent sits one level further up (depth 1).
      await goalModel.create({
        createdAt: new Date('2026-02-01T00:00:00Z'),
        subjectId: parent.id,
        subjectType: 'task',
        title: 'Carried by parent',
      });

      expect(await graphModel.findGoalByTaskId(task.id)).toEqual({
        id: goal.id,
        title: 'Carried elsewhere',
      });
    });

    it('breaks a depth tie by picking the newest goal', async () => {
      const task = await new TaskModel(serverDB, userId).create({ instruction: 'shared task' });
      // One goal is carried by the task, the other binds it to a node: both sit at depth 0.
      await goalModel.create({
        createdAt: new Date('2026-01-01T00:00:00Z'),
        subjectId: task.id,
        subjectType: 'task',
        title: 'Older goal',
      });
      const newer = await createGoal('Newer goal', new Date('2026-02-01T00:00:00Z'));
      const node = await graphModel.createNode(newer.id, { kind: 'task', title: 'Shared' });
      await graphModel.bindTask(newer.id, node!.id, task.id);

      expect(await graphModel.findGoalByTaskId(task.id)).toEqual({
        id: newer.id,
        title: 'Newer goal',
      });
    });
  });

  describe('createNodeOnce', () => {
    it('attributes an agent-authored node to the agent, not the user', async () => {
      await serverDB
        .insert(agents)
        .values({ id: 'agt_goal_graph_cov', slug: 'agt-goal-graph-cov', userId });
      const goal = await createGoal();

      const result = await graphModel.createNodeOnce(goal.id, {
        createdByAgentId: 'agt_goal_graph_cov',
        kind: 'finding',
        title: 'Agent finding',
      });

      expect(result).toMatchObject({ created: true });
      expect(result?.node).toMatchObject({
        createdByAgentId: 'agt_goal_graph_cov',
        createdByUserId: null,
      });
      const [event] = await serverDB
        .select()
        .from(goalEvents)
        .where(eq(goalEvents.entityId, result!.node.id));
      expect(event).toMatchObject({
        actorId: 'agt_goal_graph_cov',
        actorType: 'agent',
        eventType: 'created',
      });
    });
  });

  describe('updateNodeStatus', () => {
    it('records a rejection as a rejected event', async () => {
      const goal = await createGoal();
      const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'Try it' });

      const updated = await graphModel.updateNodeStatus(goal.id, node!.id, 'rejected', 'no good');

      expect(updated).toMatchObject({ id: node!.id, resolvedAt: null, status: 'rejected' });
      const [row] = await serverDB.select().from(goalNodes).where(eq(goalNodes.id, node!.id));
      expect(row.status).toBe('rejected');
      const events = await serverDB
        .select()
        .from(goalEvents)
        .where(and(eq(goalEvents.entityId, node!.id), eq(goalEvents.eventType, 'rejected')));
      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe('no good');
    });
  });
});
