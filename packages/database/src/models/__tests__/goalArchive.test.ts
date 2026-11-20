// @vitest-environment node
import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { goalNodes, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceModel } from '../acceptance';
import { GoalModel } from '../goal';
import { GoalArchivedError, GoalArchiveModel } from '../goalArchive';
import { GoalGraphModel } from '../goalGraph';
import { TaskModel } from '../task';

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

/** Give the goal its Goal-level acceptance Task, with that acceptance in `status`. */
const signOff = async (goalId: string, status: 'accepted' | 'delivered') => {
  const task = await new TaskModel(serverDB, userId).create({ instruction: 'Accept the goal' });
  const node = await graphModel.createNode(goalId, {
    kind: 'task',
    title: GOAL_ACCEPTANCE_TASK_TITLE,
  });
  await serverDB.update(goalNodes).set({ taskId: task.id }).where(eq(goalNodes.id, node!.id));
  const acceptanceModel = new AcceptanceModel(serverDB, userId);
  const acceptance = await acceptanceModel.ensureForSubject('task', task.id);
  await acceptanceModel.updateStatus(acceptance.id, status);
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('GoalArchiveModel', () => {
  it('archives a canceled goal', async () => {
    const goal = await createListedGoal('Dropped', 'canceled');

    const archived = await archiveModel.archive(goal.id);

    expect(archived?.archivedAt).toBeInstanceOf(Date);
    expect(archived?.status).toBe('canceled');
  });

  it('archives an achieved goal its owner signed off', async () => {
    const goal = await createListedGoal('Delivered', 'achieved');
    await signOff(goal.id, 'accepted');

    expect((await archiveModel.archive(goal.id))?.archivedAt).toBeInstanceOf(Date);
  });

  // The owner has no way to sign off a goal marked completed by hand, so
  // archiving cannot wait on a sign-off.
  it('archives an achieved goal with no Goal-level acceptance to sign off', async () => {
    const goal = await createListedGoal('Marked completed', 'achieved');

    expect((await archiveModel.archive(goal.id))?.archivedAt).toBeInstanceOf(Date);
  });

  it('archives an achieved goal whose sign-off is still open', async () => {
    const goal = await createListedGoal('Awaiting sign-off', 'achieved');
    await signOff(goal.id, 'delivered');

    expect((await archiveModel.archive(goal.id))?.archivedAt).toBeInstanceOf(Date);
  });

  it.each(['draft', 'planning', 'running', 'verifying', 'review', 'paused', 'failed'])(
    'refuses a %s goal',
    async (status) => {
      const goal = await createListedGoal('Not done with', status);
      await signOff(goal.id, 'accepted');

      expect(await archiveModel.archive(goal.id)).toBeNull();
      expect((await goalModel.findById(goal.id))?.archivedAt).toBeNull();
    },
  );

  it('keeps the original archive time when archived again', async () => {
    const goal = await createListedGoal('Dropped', 'canceled');
    const first = await archiveModel.archive(goal.id);

    const second = await archiveModel.archive(goal.id);

    expect(second?.archivedAt?.getTime()).toBe(first?.archivedAt?.getTime());
  });

  it('does not touch another user’s goal', async () => {
    const theirs = await new GoalModel(serverDB, otherUserId).create({
      status: 'canceled',
      title: 'Theirs',
    });

    expect(await archiveModel.archive(theirs.id)).toBeNull();
    expect(await archiveModel.unarchive(theirs.id)).toBeNull();
  });

  it('unarchives a goal', async () => {
    const goal = await createListedGoal('Dropped', 'canceled');
    await archiveModel.archive(goal.id);

    const restored = await archiveModel.unarchive(goal.id);

    expect(restored?.archivedAt).toBeNull();
  });
});

describe('GoalModel.updateStatus on an archived goal', () => {
  it('refuses to put it back in motion, whichever path asks', async () => {
    const goal = await createListedGoal('Put away', 'canceled');
    await archiveModel.archive(goal.id);

    for (const status of ['running', 'paused', 'planning', 'review', 'verifying'] as const) {
      await expect(goalModel.updateStatus(goal.id, status)).rejects.toBeInstanceOf(
        GoalArchivedError,
      );
    }
    expect((await goalModel.findById(goal.id))?.status).toBe('canceled');
  });

  it('freezes it in its archived status, ended ones included', async () => {
    const goal = await createListedGoal('Put away', 'canceled');
    await archiveModel.archive(goal.id);

    // A stale "mark achieved" would leave a hidden goal achieved but never signed off.
    for (const status of ['achieved', 'failed'] as const) {
      await expect(goalModel.updateStatus(goal.id, status)).rejects.toBeInstanceOf(
        GoalArchivedError,
      );
    }
    // Writing the status it already has is not a change.
    expect((await goalModel.updateStatus(goal.id, 'canceled'))?.status).toBe('canceled');
    expect((await goalModel.findById(goal.id))?.status).toBe('canceled');
  });

  it('moves an unarchived goal as before', async () => {
    const goal = await createListedGoal('Live', 'achieved');

    expect((await goalModel.updateStatus(goal.id, 'running'))?.status).toBe('running');
  });
});

describe('GoalModel.list archive filter', () => {
  it('hides archived goals by default and lists only them when asked', async () => {
    const kept = await createListedGoal('Kept', 'canceled');
    const putAway = await createListedGoal('Put away', 'canceled');
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
    await signOff(achieved.id, 'accepted');
    const canceled = await createListedGoal('Canceled', 'canceled');
    await archiveModel.archive(achieved.id);
    await archiveModel.archive(canceled.id);

    const { goals: rows } = await goalModel.list({ archived: true, statuses: ['achieved'] });

    expect(rows.map((item) => item.goal.id)).toEqual([achieved.id]);
  });

  it('lists a restored goal again', async () => {
    const goal = await createListedGoal('Back', 'canceled');
    await archiveModel.archive(goal.id);
    await archiveModel.unarchive(goal.id);

    expect((await goalModel.list()).goals.map((item) => item.goal.id)).toEqual([goal.id]);
    expect((await goalModel.list({ archived: true })).total).toBe(0);
  });
});

describe('GoalModel.list signedOff', () => {
  it('marks an achieved goal signed off only once its acceptance is accepted', async () => {
    const signed = await createListedGoal('Signed', 'achieved');
    await signOff(signed.id, 'accepted');
    const awaiting = await createListedGoal('Awaiting', 'achieved');
    await signOff(awaiting.id, 'delivered');

    const { goals: rows } = await goalModel.list();
    const byId = Object.fromEntries(rows.map((item) => [item.goal.id, item.signedOff]));

    expect(byId).toEqual({ [awaiting.id]: false, [signed.id]: true });
  });
});
