// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { goals, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';

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
