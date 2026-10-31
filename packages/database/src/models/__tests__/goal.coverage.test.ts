// @vitest-environment node
import { eq, type SQL } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalGraphModel } from '../goalGraph';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-coverage-user';
const otherUserId = 'goal-coverage-other';

const goalModel = new GoalModel(serverDB, userId);
const otherGoalModel = new GoalModel(serverDB, otherUserId);
const graphModel = new GoalGraphModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('GoalModel coverage', () => {
  describe('lockUnfinishedBySubjectTopics', () => {
    it('returns nothing for an empty topic list', async () => {
      expect(await goalModel.lockUnfinishedBySubjectTopics([])).toEqual([]);
    });

    it('locks only the caller’s unfinished topic goals for those topics', async () => {
      const open = await goalModel.create({
        status: 'running',
        subjectId: 'topic-a',
        subjectType: 'topic',
        title: 'Open',
      });
      await goalModel.create({
        status: 'achieved',
        subjectId: 'topic-a',
        subjectType: 'topic',
        title: 'Finished',
      });
      await goalModel.create({
        status: 'running',
        subjectId: 'topic-b',
        subjectType: 'topic',
        title: 'Other topic',
      });
      await goalModel.create({
        status: 'running',
        subjectId: 'topic-a',
        subjectType: 'task',
        title: 'Not topic-carried',
      });
      await otherGoalModel.create({
        status: 'running',
        subjectId: 'topic-a',
        subjectType: 'topic',
        title: 'Someone else',
      });

      const locked = await serverDB.transaction((tx) =>
        new GoalModel(tx as unknown as LobeChatDatabase, userId).lockUnfinishedBySubjectTopics([
          'topic-a',
        ]),
      );

      expect(locked.map((goal) => goal.id)).toEqual([open.id]);
    });
  });

  describe('list', () => {
    it('reports zero run stats for a goal whose graph has no task node', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Question only' });
      await graphModel.createNode(goal.id, { kind: 'problem', title: 'What is it?' });

      const { goals, total } = await goalModel.list();

      expect(total).toBe(1);
      expect(goals).toEqual([
        expect.objectContaining({
          findingCount: 0,
          goal: expect.objectContaining({ id: goal.id }),
          pendingDecisions: 0,
          taskDone: 0,
          taskTotal: 0,
          totalRunCost: 0,
          totalRunDuration: 0,
        }),
      ]);
    });

    it('falls back to zero node counts when the node roll-up misses a listed goal', async () => {
      // The roll-up runs after the page query, so a goal whose nodes disappear in
      // between (e.g. a concurrent draft cleanup) has no roll-up row.
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Raced' });
      await graphModel.createNode(goal.id, { kind: 'finding', title: 'Seen' });
      const proxyDB = createProxyTestDB(serverDB, (query, result) =>
        query.includes('group by "goal_nodes"."goal_id", "goal_nodes"."kind"') ? [] : result.rows,
      );
      // pg-proxy's `execute` hands back bare rows; the run-stats CTE reads `{ rows }`
      // from the real driver, so route raw SQL to the test database unchanged.
      vi.spyOn(proxyDB, 'execute').mockImplementation(((query: SQL) =>
        serverDB.execute(query)) as unknown as LobeChatDatabase['execute']);
      const proxied = new GoalModel(proxyDB, userId);

      const { goals, total } = await proxied.list();

      expect(total).toBe(1);
      expect(goals).toEqual([
        expect.objectContaining({
          findingCount: 0,
          goal: expect.objectContaining({ id: goal.id }),
          taskDone: 0,
          taskTotal: 0,
        }),
      ]);
    });

    it('treats a count aggregate that returns no row as an empty list', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Hidden' });
      await graphModel.createNode(goal.id, { kind: 'problem', title: 'Seeded' });
      const proxied = new GoalModel(
        createProxyTestDB(serverDB, (query, result) =>
          query.includes('count(*)') ? [] : result.rows,
        ),
        userId,
      );

      expect(await proxied.list()).toEqual({ goals: [], total: 0 });
    });
  });
});
