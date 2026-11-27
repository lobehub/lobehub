// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, taskTopics, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { resolveRunNote, TaskTopicModel } from '../taskTopic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-range-runs-user';
const otherUserId = 'task-range-runs-other-user';

const createTopic = async (id: string, uid = userId, agentId?: string) => {
  await serverDB.insert(topics).values({ agentId, id, userId: uid }).onConflictDoNothing();
  return id;
};

const startedAt = (topicId: string, at: string) =>
  serverDB
    .update(taskTopics)
    .set({ createdAt: new Date(at) })
    .where(eq(taskTopics.topicId, topicId));

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

const NOVEMBER = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-12-01T00:00:00Z') };

describe('TaskTopicModel.findRunsInRange', () => {
  it('returns the runs started inside the window, oldest first, with their notes', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const topicModel = new TaskTopicModel(serverDB, userId);
    const digest = await taskModel.create({ instruction: 'Inbox digest' });
    await serverDB.insert(agents).values({ id: 'agt_range_runs', userId });

    const runs = [
      ['tpc_oct', '2026-10-31T23:59:00Z', 'completed'],
      ['tpc_nov_3', '2026-11-03T09:00:00Z', 'completed'],
      ['tpc_nov_2', '2026-11-02T09:00:00Z', 'failed'],
      ['tpc_dec', '2026-12-01T00:00:00Z', 'completed'],
    ] as const;
    for (const [index, [topicId, at, status]] of runs.entries()) {
      await topicModel.add(digest.id, await createTopic(topicId, userId, 'agt_range_runs'), {
        seq: index + 1,
        trigger: 'schedule',
      });
      await topicModel.updateStatus(digest.id, topicId, status);
      await startedAt(topicId, at);
    }
    await topicModel.updateHandoff(digest.id, 'tpc_nov_3', { title: 'Inbox zero by 9:04' });
    await topicModel.updateHandoff(digest.id, 'tpc_nov_2', {
      summary: 'Gmail rejected the token. Retried twice.',
    });

    const { runsByTaskId, truncated } = await topicModel.findRunsInRange([digest.id], {
      ...NOVEMBER,
      limit: 100,
    });

    expect(truncated).toBe(false);
    // The window is half-open: Oct 31 and Dec 1 00:00 both fall outside it.
    expect(runsByTaskId.get(digest.id)).toEqual([
      expect.objectContaining({
        // The agent the run wrote to, whoever the task is assigned to now.
        agentId: 'agt_range_runs',
        completedAt: expect.any(Date),
        note: 'Gmail rejected the token.',
        status: 'failed',
        topicId: 'tpc_nov_2',
        trigger: 'schedule',
      }),
      expect.objectContaining({
        note: 'Inbox zero by 9:04',
        status: 'completed',
        topicId: 'tpc_nov_3',
      }),
    ]);
  });

  it('caps the rows across tasks and leaves out tasks the caller cannot read', async () => {
    const topicModel = new TaskTopicModel(serverDB, userId);
    const mine = await new TaskModel(serverDB, userId).create({ instruction: 'Mine' });
    const theirs = await new TaskModel(serverDB, otherUserId).create({ instruction: 'Theirs' });
    for (const seq of [1, 2, 3]) {
      const topicId = await createTopic(`tpc_mine_${seq}`);
      await topicModel.add(mine.id, topicId, { seq });
      await startedAt(topicId, `2026-11-0${seq}T08:00:00Z`);
    }
    const theirTopic = await createTopic('tpc_theirs', otherUserId);
    await new TaskTopicModel(serverDB, otherUserId).add(theirs.id, theirTopic, { seq: 1 });
    await startedAt(theirTopic, '2026-11-02T08:00:00Z');

    const { runsByTaskId, truncated } = await topicModel.findRunsInRange([mine.id, theirs.id], {
      ...NOVEMBER,
      limit: 2,
    });

    expect([...runsByTaskId.keys()]).toEqual([mine.id]);
    expect(runsByTaskId.get(mine.id)?.map((run) => run.seq)).toEqual([1, 2]);
    // The third run was cut, and the caller is told so.
    expect(truncated).toBe(true);
  });

  it('reads nothing for an empty page or an empty window', async () => {
    const topicModel = new TaskTopicModel(serverDB, userId);
    expect(
      (await topicModel.findRunsInRange([], { ...NOVEMBER, limit: 10 })).runsByTaskId.size,
    ).toBe(0);
    expect(
      (
        await topicModel.findRunsInRange(['task-x'], {
          from: NOVEMBER.to,
          limit: 10,
          to: NOVEMBER.from,
        })
      ).runsByTaskId.size,
    ).toBe(0);
  });
});

describe('resolveRunNote', () => {
  it('prefers the title, falls back to the first summary sentence, and trims long notes', () => {
    expect(resolveRunNote({ summary: 'ignored', title: '  Done  ' })).toBe('Done');
    expect(resolveRunNote({ summary: '已清空收件箱。明天继续。' })).toBe('已清空收件箱。');
    expect(resolveRunNote({ summary: 'First line\nsecond line' })).toBe('First line');
    expect(resolveRunNote({ title: 'x'.repeat(200) })).toHaveLength(80);
    expect(resolveRunNote(null)).toBeNull();
    expect(resolveRunNote({})).toBeNull();
  });
});
