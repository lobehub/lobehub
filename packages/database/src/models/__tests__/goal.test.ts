// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, goals, tasks, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'goal-model-test-user-id';
const otherUserId = 'goal-model-test-user-2';
const goalModel = new GoalModel(serverDB, userId);

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
        subjectId: 'tsk_1',
        subjectType: 'task',
        title: 'Ship the goals table',
      });

      expect(result.id).toMatch(/^goal_/);
      expect(result).toMatchObject({
        status: 'planning',
        subjectId: 'tsk_1',
        subjectType: 'task',
        title: 'Ship the goals table',
        userId,
      });
    });

    it('persists budget and requirement', async () => {
      const result = await goalModel.create({
        maxRounds: 5,
        maxTotalCost: 12.5,
        requirement: 'All tests pass',
        subjectId: 'tsk_2',
        subjectType: 'task',
        title: 'Budgeted goal',
      });

      expect(result.maxRounds).toBe(5);
      expect(result.maxTotalCost).toBe(12.5);
      expect(result.requirement).toBe('All tests pass');
    });
  });

  describe('findBySubject', () => {
    it('finds the goal bound to a carrier', async () => {
      const created = await goalModel.create({
        subjectId: 'tsk_3',
        subjectType: 'task',
        title: 'Carrier goal',
      });

      const found = await goalModel.findBySubject('task', 'tsk_3');
      expect(found?.id).toBe(created.id);
    });

    it('does not cross user boundaries', async () => {
      const otherModel = new GoalModel(serverDB, otherUserId);
      await otherModel.create({ subjectId: 'tsk_4', subjectType: 'task', title: 'Not mine' });

      const found = await goalModel.findBySubject('task', 'tsk_4');
      expect(found).toBeUndefined();
    });
  });

  describe('listBySubjects', () => {
    it('returns goals for the asked carriers only', async () => {
      await goalModel.create({ subjectId: 'tsk_a', subjectType: 'task', title: 'A' });
      await goalModel.create({ subjectId: 'tsk_b', subjectType: 'task', title: 'B' });
      await goalModel.create({ subjectId: 'tsk_c', subjectType: 'task', title: 'C' });

      const rows = await goalModel.listBySubjects('task', ['tsk_a', 'tsk_c']);
      expect(rows.map((r) => r.subjectId).sort()).toEqual(['tsk_a', 'tsk_c']);
    });

    it('returns empty for an empty id list', async () => {
      expect(await goalModel.listBySubjects('task', [])).toEqual([]);
    });
  });

  describe('list', () => {
    it('applies the carrier task visibility boundary in a workspace', async () => {
      const workspaceId = 'goal-list-visibility-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Goal list visibility',
        primaryOwnerId: userId,
        slug: workspaceId,
      });

      const ownerTasks = new TaskModel(serverDB, userId, workspaceId);
      const ownerGoals = new GoalModel(serverDB, userId, workspaceId);
      const privateTask = await ownerTasks.create({
        instruction: 'private',
        visibility: 'private',
      });
      const publicTask = await ownerTasks.create({ instruction: 'public', visibility: 'public' });
      await ownerGoals.create({
        subjectId: privateTask.id,
        subjectType: 'task',
        title: 'Private goal',
      });
      await ownerGoals.create({
        subjectId: publicTask.id,
        subjectType: 'task',
        title: 'Public goal',
      });

      const memberGoals = new GoalModel(serverDB, otherUserId, workspaceId);
      const result = await memberGoals.list();

      expect(result.total).toBe(1);
      expect(result.goals.map(({ id }) => id)).toEqual([publicTask.id]);
    });

    it('filters by the carrier task current assignee instead of the goal snapshot', async () => {
      const oldAgentId = 'goal-list-old-agent';
      const newAgentId = 'goal-list-new-agent';
      await serverDB.insert(agents).values([
        { id: oldAgentId, slug: oldAgentId, userId },
        { id: newAgentId, slug: newAgentId, userId },
      ]);
      const task = await new TaskModel(serverDB, userId).create({
        assigneeAgentId: oldAgentId,
        instruction: 'reassign me',
      });
      await goalModel.create({
        agentId: oldAgentId,
        subjectId: task.id,
        subjectType: 'task',
        title: 'Reassigned goal',
      });
      await serverDB
        .update(tasks)
        .set({ assigneeAgentId: newAgentId })
        .where(eq(tasks.id, task.id));

      expect((await goalModel.list({ agentId: oldAgentId })).total).toBe(0);
      expect((await goalModel.list({ agentId: newAgentId })).goals[0]?.id).toBe(task.id);
    });
  });

  describe('updateStatus', () => {
    it('stamps startedAt on first entry into running', async () => {
      const { id } = await goalModel.create({
        subjectId: 'tsk_5',
        subjectType: 'task',
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
        subjectId: 'tsk_6',
        subjectType: 'task',
        title: 'Terminal goal',
      });

      const achieved = await goalModel.updateStatus(id, 'achieved');
      expect(achieved?.completedAt).toBeInstanceOf(Date);

      const reopened = await goalModel.updateStatus(id, 'running');
      expect(reopened?.completedAt).toBeNull();
    });

    it('returns undefined for a goal outside the scope', async () => {
      const otherModel = new GoalModel(serverDB, otherUserId);
      const { id } = await otherModel.create({
        subjectId: 'tsk_7',
        subjectType: 'task',
        title: 'Not mine',
      });

      expect(await goalModel.updateStatus(id, 'running')).toBeUndefined();
    });
  });

  describe('deleteBySubject', () => {
    it('removes the goal bound to the carrier', async () => {
      await goalModel.create({ subjectId: 'tsk_8', subjectType: 'task', title: 'Doomed' });

      await goalModel.deleteBySubject('task', 'tsk_8');

      const rows = await serverDB.query.goals.findMany({ where: eq(goals.userId, userId) });
      expect(rows).toHaveLength(0);
    });
  });
});
