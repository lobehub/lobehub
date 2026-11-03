// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalArchiveModel } from '../goalArchive';
import { GoalGraphModel } from '../goalGraph';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-archive-user';
const otherUserId = 'goal-archive-other';

const goalModel = new GoalModel(serverDB, userId);
const graphModel = new GoalGraphModel(serverDB, userId);
const archiveModel = new GoalArchiveModel(serverDB, userId);

/** A goal with a graph, so `list` shows it. */
const createListedGoal = async (title: string, status: string) => {
  const goal = await goalModel.create({
    status: status as never,
    subjectType: 'standalone',
    title,
  });
  await graphModel.createNode(goal.id, { kind: 'problem', title });
  return goal;
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('GoalArchiveModel', () => {
  it.each(['draft', 'achieved', 'failed', 'canceled'])('archives a %s goal', async (status) => {
    const goal = await createListedGoal('Done', status);

    const archived = await archiveModel.archive(goal.id);

    expect(archived?.archivedAt).toBeInstanceOf(Date);
    expect(archived?.status).toBe(status);
  });

  it.each(['planning', 'running', 'verifying', 'review', 'paused'])(
    'refuses a %s goal, which can still move on its own',
    async (status) => {
      const goal = await createListedGoal('Live', status);

      expect(await archiveModel.archive(goal.id)).toBeNull();
      expect((await goalModel.findById(goal.id))?.archivedAt).toBeNull();
    },
  );

  it('keeps the original archive time when archived again', async () => {
    const goal = await createListedGoal('Done', 'achieved');
    const first = await archiveModel.archive(goal.id);

    const second = await archiveModel.archive(goal.id);

    expect(second?.archivedAt?.getTime()).toBe(first?.archivedAt?.getTime());
  });

  it('does not touch another user’s goal', async () => {
    const theirs = await new GoalModel(serverDB, otherUserId).create({
      status: 'achieved',
      title: 'Theirs',
    });

    expect(await archiveModel.archive(theirs.id)).toBeNull();
    expect(await archiveModel.unarchive(theirs.id)).toBeNull();
  });

  it('unarchives a goal', async () => {
    const goal = await createListedGoal('Done', 'achieved');
    await archiveModel.archive(goal.id);

    const restored = await archiveModel.unarchive(goal.id);

    expect(restored?.archivedAt).toBeNull();
  });
});

describe('GoalModel.list archive filter', () => {
  it('hides archived goals by default and lists only them when asked', async () => {
    const kept = await createListedGoal('Kept', 'achieved');
    const putAway = await createListedGoal('Put away', 'achieved');
    await archiveModel.archive(putAway.id);

    const visible = await goalModel.list();
    expect(visible.total).toBe(1);
    expect(visible.goals.map((item) => item.goal.id)).toEqual([kept.id]);

    const archived = await goalModel.list({ archived: true });
    expect(archived.total).toBe(1);
    expect(archived.goals.map((item) => item.goal.id)).toEqual([putAway.id]);
    expect(archived.goals[0].goal.archivedAt).toBeInstanceOf(Date);
  });

  it('combines the archive filter with a status filter', async () => {
    const achieved = await createListedGoal('Achieved', 'achieved');
    const canceled = await createListedGoal('Canceled', 'canceled');
    await archiveModel.archive(achieved.id);
    await archiveModel.archive(canceled.id);

    const { goals: rows } = await goalModel.list({ archived: true, statuses: ['achieved'] });

    expect(rows.map((item) => item.goal.id)).toEqual([achieved.id]);
  });

  it('lists a restored goal again', async () => {
    const goal = await createListedGoal('Back', 'achieved');
    await archiveModel.archive(goal.id);
    await archiveModel.unarchive(goal.id);

    expect((await goalModel.list()).goals.map((item) => item.goal.id)).toEqual([goal.id]);
    expect((await goalModel.list({ archived: true })).total).toBe(0);
  });
});
