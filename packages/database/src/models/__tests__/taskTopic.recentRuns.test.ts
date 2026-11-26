// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { TaskTopicModel } from '../taskTopic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-recent-runs-user';
const otherUserId = 'task-recent-runs-other-user';

const createTopic = async (id: string, uid = userId) => {
  await serverDB.insert(topics).values({ id, userId: uid }).onConflictDoNothing();
  return id;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TaskTopicModel.findRecentRunsByTaskIds', () => {
  it('returns the latest runs of each task, newest first, capped per task', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const topicModel = new TaskTopicModel(serverDB, userId);
    const daily = await taskModel.create({ instruction: 'Daily digest' });
    const hourly = await taskModel.create({ instruction: 'Hourly check' });
    const idle = await taskModel.create({ instruction: 'Never ran' });

    for (const seq of [1, 2, 3, 4]) {
      const topicId = await createTopic(`tpc_daily_${seq}`);
      await topicModel.add(daily.id, topicId, { seq, trigger: 'schedule' });
      await topicModel.updateStatus(daily.id, topicId, seq === 3 ? 'failed' : 'completed');
    }
    await topicModel.add(hourly.id, await createTopic('tpc_hourly_1'), {
      seq: 1,
      trigger: 'heartbeat',
    });

    const runs = await topicModel.findRecentRunsByTaskIds([daily.id, hourly.id, idle.id], 3);

    // Capped at 3 per task: the cap is per task, not across the whole page.
    expect(runs.get(daily.id)?.map((run) => [run.seq, run.status])).toEqual([
      [4, 'completed'],
      [3, 'failed'],
      [2, 'completed'],
    ]);
    // Settling a run stamps its topic; that is the run's finish time.
    expect(runs.get(daily.id)?.[0]).toMatchObject({
      completedAt: expect.any(Date),
      topicId: 'tpc_daily_4',
      trigger: 'schedule',
    });
    expect(runs.get(hourly.id)).toMatchObject([
      { completedAt: null, seq: 1, status: 'running', trigger: 'heartbeat' },
    ]);
    expect(runs.has(idle.id)).toBe(false);
  });

  it('leaves out runs of tasks the caller cannot read', async () => {
    const mine = await new TaskModel(serverDB, userId).create({ instruction: 'Mine' });
    const theirs = await new TaskModel(serverDB, otherUserId).create({ instruction: 'Theirs' });
    await new TaskTopicModel(serverDB, userId).add(mine.id, await createTopic('tpc_mine'), {
      seq: 1,
    });
    await new TaskTopicModel(serverDB, otherUserId).add(
      theirs.id,
      await createTopic('tpc_theirs', otherUserId),
      { seq: 1 },
    );

    const runs = await new TaskTopicModel(serverDB, userId).findRecentRunsByTaskIds(
      [mine.id, theirs.id],
      5,
    );

    expect([...runs.keys()]).toEqual([mine.id]);
  });

  it('reads nothing for an empty page', async () => {
    const runs = await new TaskTopicModel(serverDB, userId).findRecentRunsByTaskIds([], 5);
    expect(runs.size).toBe(0);
  });
});
