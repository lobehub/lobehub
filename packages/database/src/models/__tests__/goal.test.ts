// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, goalEdges, goalNodeDecisions, goalNodes, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalGraphModel } from '../goalGraph';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'goal-model-test-user-id';
const otherUserId = 'goal-model-test-user-2';
const goalModel = new GoalModel(serverDB, userId);
const graphModel = new GoalGraphModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('GoalModel', () => {
  describe('create', () => {
    it('creates a goal with defaults', async () => {
      const result = await goalModel.create({
        subjectType: 'standalone',
        title: 'Ship the goals table',
      });

      expect(result.id).toMatch(/^goal_/);
      expect(result).toMatchObject({
        status: 'planning',
        subjectType: 'standalone',
        title: 'Ship the goals table',
        userId,
      });
    });

    it('persists budget and requirement', async () => {
      const result = await goalModel.create({
        maxRounds: 5,
        maxTotalCost: 12.5,
        requirement: 'All tests pass',
        subjectType: 'standalone',
        title: 'Budgeted goal',
      });

      expect(result.maxRounds).toBe(5);
      expect(result.maxTotalCost).toBe(12.5);
      expect(result.requirement).toBe('All tests pass');
    });
  });

  describe('findByWorkTask', () => {
    it('finds the goal whose graph owns a Work Task', async () => {
      const task = await new TaskModel(serverDB, userId).create({ instruction: 'do the work' });
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Owner' });
      const node = await graphModel.createNode(goal.id, { kind: 'work', title: 'W1' });
      await serverDB.update(goalNodes).set({ taskId: task.id }).where(eq(goalNodes.id, node!.id));

      expect((await goalModel.findByWorkTask(task.id))?.id).toBe(goal.id);
    });

    it('does not cross user boundaries', async () => {
      const otherGoals = new GoalModel(serverDB, otherUserId);
      const otherGraph = new GoalGraphModel(serverDB, otherUserId);
      const task = await new TaskModel(serverDB, otherUserId).create({ instruction: 'theirs' });
      const goal = await otherGoals.create({ subjectType: 'standalone', title: 'Theirs' });
      const node = await otherGraph.createNode(goal.id, { kind: 'work', title: 'W1' });
      await serverDB.update(goalNodes).set({ taskId: task.id }).where(eq(goalNodes.id, node!.id));

      expect(await goalModel.findByWorkTask(task.id)).toBeUndefined();
    });
  });

  describe('list', () => {
    it('lists goals the caller owns, newest first, with the graph roll-up', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Reproduce it' });
      const problem = await graphModel.createNode(goal.id, { kind: 'problem', title: 'P1' });
      const done = await graphModel.createNode(goal.id, { kind: 'work', title: 'W1' });
      await graphModel.createNode(goal.id, { kind: 'work', title: 'W2' });
      await graphModel.createNode(goal.id, { kind: 'finding', title: 'F1' });
      await graphModel.createEdge(goal.id, problem!.id, done!.id, 'decomposes');
      await graphModel.updateNodeStatus(goal.id, done!.id, 'resolved');

      const { goals, total } = await goalModel.list();

      expect(total).toBe(1);
      expect(goals[0]).toMatchObject({
        findingCount: 1,
        pendingDecisions: 0,
        workDone: 1,
        workTotal: 2,
      });
      expect(goals[0].goal.id).toBe(goal.id);
    });

    it('counts only the decision gates still waiting on a human', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Gated' });
      const open = await graphModel.createNode(goal.id, { kind: 'decision', title: 'D1' });
      const closed = await graphModel.createNode(goal.id, { kind: 'decision', title: 'D2' });
      await graphModel.createDecision(goal.id, open!.id, {
        authority: 'user',
        question: 'retry?',
      });
      await graphModel.createDecision(goal.id, closed!.id, {
        authority: 'user',
        question: 'retire?',
      });
      await serverDB
        .update(goalNodeDecisions)
        .set({ status: 'resolved' })
        .where(eq(goalNodeDecisions.nodeId, closed!.id));

      expect((await goalModel.list()).goals[0].pendingDecisions).toBe(1);
    });

    it('does not leak another user’s goals', async () => {
      await new GoalModel(serverDB, otherUserId).create({
        subjectType: 'standalone',
        title: 'Not mine',
      });

      expect((await goalModel.list()).total).toBe(0);
    });

    it('scopes by the goal’s responsible agent', async () => {
      const mine = 'goal-list-agent-a';
      const theirs = 'goal-list-agent-b';
      await serverDB.insert(agents).values([
        { id: mine, slug: mine, userId },
        { id: theirs, slug: theirs, userId },
      ]);
      await goalModel.create({ agentId: mine, subjectType: 'standalone', title: 'Mine' });
      await goalModel.create({ agentId: theirs, subjectType: 'standalone', title: 'Theirs' });

      const scoped = await goalModel.list({ agentId: mine });
      expect(scoped.total).toBe(1);
      expect(scoped.goals[0].goal.title).toBe('Mine');
    });

    it('filters by lifecycle status', async () => {
      const running = await goalModel.create({ subjectType: 'standalone', title: 'Running' });
      const achieved = await goalModel.create({ subjectType: 'standalone', title: 'Achieved' });
      await goalModel.updateStatus(running.id, 'running');
      await goalModel.updateStatus(achieved.id, 'achieved');

      const open = await goalModel.list({ statuses: ['running'] });
      expect(open.goals.map(({ goal }) => goal.title)).toEqual(['Running']);
    });
  });

  describe('updateStatus', () => {
    it('stamps startedAt on first entry into running', async () => {
      const { id } = await goalModel.create({
        subjectType: 'standalone',
        title: 'Lifecycle goal',
      });

      const running = await goalModel.updateStatus(id, 'running');
      expect(running?.status).toBe('running');
      expect(running?.startedAt).toBeInstanceOf(Date);

      // A later transition keeps the original startedAt.
      const verifying = await goalModel.updateStatus(id, 'verifying');
      expect(verifying?.startedAt).toEqual(running?.startedAt);
    });

    it('stamps completedAt on terminal states and clears it on re-open', async () => {
      const { id } = await goalModel.create({
        subjectType: 'standalone',
        title: 'Terminal goal',
      });

      const achieved = await goalModel.updateStatus(id, 'achieved');
      expect(achieved?.completedAt).toBeInstanceOf(Date);

      const reopened = await goalModel.updateStatus(id, 'running');
      expect(reopened?.completedAt).toBeNull();
    });

    it('returns undefined for a goal outside the scope', async () => {
      const otherModel = new GoalModel(serverDB, otherUserId);
      const { id } = await otherModel.create({ subjectType: 'standalone', title: 'Not mine' });

      expect(await goalModel.updateStatus(id, 'running')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('cascades the whole graph away with the goal', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Doomed' });
      const problem = await graphModel.createNode(goal.id, { kind: 'problem', title: 'P1' });
      const work = await graphModel.createNode(goal.id, { kind: 'work', title: 'W1' });
      await graphModel.createEdge(goal.id, problem!.id, work!.id, 'decomposes');

      await goalModel.delete(goal.id);

      expect(
        await serverDB.query.goalNodes.findMany({ where: eq(goalNodes.goalId, goal.id) }),
      ).toHaveLength(0);
      expect(
        await serverDB.query.goalEdges.findMany({ where: eq(goalEdges.goalId, goal.id) }),
      ).toHaveLength(0);
    });
  });
});
