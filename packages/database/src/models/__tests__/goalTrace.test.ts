// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { goalTraces, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalTraceModel } from '../goalTrace';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'goal-trace-model-test-user-id';
const otherUserId = 'goal-trace-model-test-user-2';

const goalModel = new GoalModel(serverDB, userId);
const goalTraceModel = new GoalTraceModel(serverDB, userId);
const otherGoalTraceModel = new GoalTraceModel(serverDB, otherUserId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(goalTraces);
  await serverDB.delete(users);
});

describe('GoalTraceModel', () => {
  describe('upsert', () => {
    it('should insert a trace row for a goal', async () => {
      const goal = await goalModel.create({ title: 'Traceable goal' });

      const row = await goalTraceModel.upsert({
        advancesTotal: 3,
        goalId: goal.id,
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        ticksTotal: 5,
      });

      expect(row.goalId).toBe(goal.id);
      expect(row.advancesTotal).toBe(3);
      expect(row.ticksTotal).toBe(5);
    });

    it('should rewrite the whole row when the goal is advanced again', async () => {
      const goal = await goalModel.create({ title: 'Rewritten goal' });

      await goalTraceModel.upsert({ advancesTotal: 1, goalId: goal.id });

      const updated = await goalTraceModel.upsert({
        advancesTotal: 7,
        finalStatus: 'completed',
        goalId: goal.id,
        totalCost: 1.25,
      });

      expect(updated.advancesTotal).toBe(7);
      expect(updated.finalStatus).toBe('completed');

      // 1:1 with the goal — the second write must not append a second row.
      const rows = await serverDB.select().from(goalTraces);
      expect(rows).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return the trace joined with the goal title', async () => {
      const goal = await goalModel.create({ title: 'Joined goal' });
      await goalTraceModel.upsert({ findingsTotal: 2, goalId: goal.id });

      const found = await goalTraceModel.findById(goal.id);

      expect(found?.goalId).toBe(goal.id);
      expect(found?.findingsTotal).toBe(2);
      expect(found?.title).toBe('Joined goal');
    });

    it('should read another user goal as absent', async () => {
      const goal = await goalModel.create({ title: 'Private goal' });
      await goalTraceModel.upsert({ goalId: goal.id });

      expect(await otherGoalTraceModel.findById(goal.id)).toBeUndefined();
    });

    it('should return undefined when the goal has no trace', async () => {
      const goal = await goalModel.create({ title: 'Untraced goal' });

      expect(await goalTraceModel.findById(goal.id)).toBeUndefined();
      expect(await goalTraceModel.findById('non-existent-goal')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should return owned traces with the newest run first', async () => {
      const older = await goalModel.create({ title: 'Older run' });
      const newer = await goalModel.create({ title: 'Newer run' });

      await goalTraceModel.upsert({
        goalId: older.id,
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      await goalTraceModel.upsert({
        goalId: newer.id,
        startedAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      const list = await goalTraceModel.list();

      expect(list.map((item) => item.title)).toEqual(['Newer run', 'Older run']);
    });

    it('should apply the requested limit', async () => {
      const older = await goalModel.create({ title: 'Limited older' });
      const newer = await goalModel.create({ title: 'Limited newer' });

      await goalTraceModel.upsert({
        goalId: older.id,
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      await goalTraceModel.upsert({
        goalId: newer.id,
        startedAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      const list = await goalTraceModel.list(1);

      expect(list).toHaveLength(1);
      expect(list[0].title).toBe('Limited newer');
    });

    it('should not list traces owned by another user', async () => {
      const goal = await goalModel.create({ title: 'Other owner goal' });
      await goalTraceModel.upsert({ goalId: goal.id });

      // Start from a clean slate so the assertion is not polluted by other cases.
      await serverDB.delete(goalTraces);

      const goal2 = await goalModel.create({ title: 'Owned again' });
      await goalTraceModel.upsert({ goalId: goal2.id });

      const list = await otherGoalTraceModel.list();

      expect(list).toEqual([]);
    });
  });
});
