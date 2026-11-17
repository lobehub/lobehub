// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';
import { RecentModel } from '@/database/models/recent';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { tasks, topics, trashItems, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { TaskService } from '@/server/services/task';
import { TaskBatchService } from '@/server/services/task/batch';

import { TrashService } from '../index';

vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({ deleteFile: vi.fn(), deleteFiles: vi.fn() })),
}));

const userId = 'trash-task-user';

// Module-level: the first call migrates a fresh database, which can outlast a
// hook timeout on a loaded CI shard.
const db: LobeChatDatabase = await getTestDB();

describe('TrashService — tasks', () => {
  let taskModel: TaskModel;
  let trash: TrashService;

  beforeEach(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await db.insert(users).values({ id: userId });
    taskModel = new TaskModel(db, userId);
    trash = new TrashService(db, userId);
  });

  afterEach(async () => {
    await db.delete(users).where(eq(users.id, userId));
  });

  const createTask = (data: Record<string, unknown> = {}) =>
    taskModel.create({ instruction: 'Do the thing', name: 'Write report', ...data });

  /** A task with one linked topic (a past run). */
  const createTaskWithTopic = async () => {
    const task = await createTask();
    const topic = await new TopicModel(db, userId).create({ title: 'Run 1' });
    await new TaskTopicModel(db, userId).add(task.id, topic.id, { seq: 1 });
    return { task, topic };
  };

  const rootOf = async (taskId: string) => {
    const { items } = await trash.list({ resourceType: 'task' });
    return items.find((item) => item.resourceId === taskId);
  };

  const rawTask = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];
  const rawTopic = async (id: string) =>
    (await db.select().from(topics).where(eq(topics.id, id)))[0];

  it('a batch delete moves tasks into the bin with their topics, and restore brings both back', async () => {
    const { task, topic } = await createTaskWithTopic();

    const result = await new TaskBatchService(db, userId).delete([task.id]);
    expect(result.updated).toEqual([task.id]);

    // Hidden from reads, but the rows are still there, stamped.
    expect(await taskModel.findById(task.id)).toBeNull();
    expect((await rawTask(task.id))?.isDeleted).toBe(true);
    expect(await new TopicModel(db, userId).findById(topic.id)).toBeUndefined();
    expect((await rawTopic(topic.id))?.isDeleted).toBe(true);

    const root = await rootOf(task.id);
    expect(root).toMatchObject({
      meta: expect.objectContaining({ childCount: 1, kind: task.identifier }),
      resourceType: 'task',
      title: 'Write report',
    });
    // The topic is registered under the task, never listed on its own.
    const { items: topicRoots } = await trash.list({ resourceType: 'topic' });
    expect(topicRoots.some((item) => item.resourceId === topic.id)).toBe(false);

    const outcome = await trash.restore([root!.id]);
    expect(outcome.failed).toEqual([]);
    expect(await taskModel.findById(task.id)).not.toBeNull();
    expect(await new TopicModel(db, userId).findById(topic.id)).toBeDefined();
    expect(await rootOf(task.id)).toBeUndefined();
  });

  it('the single-task delete goes to the bin too', async () => {
    const { task, topic } = await createTaskWithTopic();

    await new TaskService(db, userId).deleteTask(task.id);

    expect(await taskModel.findById(task.id)).toBeNull();
    expect((await rawTopic(topic.id))?.isDeleted).toBe(true);
    expect(await rootOf(task.id)).toMatchObject({
      meta: expect.objectContaining({ childCount: 1 }),
    });
  });

  it('keeps subtasks live while the parent is in the bin, and blocks restoring a trashed subtask first', async () => {
    const parent = await createTask({ name: 'Parent' });
    const child = await createTask({ name: 'Child', parentTaskId: parent.id });
    const other = await createTask({ name: 'Other child', parentTaskId: parent.id });

    await new TaskBatchService(db, userId).delete([parent.id, child.id]);

    // Not cascaded: the untouched subtask stays visible, still pointing at its parent.
    expect(await taskModel.findById(other.id)).toMatchObject({ parentTaskId: parent.id });

    const childRoot = await rootOf(child.id);
    const parentRoot = await rootOf(parent.id);
    expect((await trash.restore([childRoot!.id])).failed).toEqual([
      { code: 'parentTrashed', id: childRoot!.id },
    ]);

    // Restoring both in one call works whichever order the registry hands them over.
    const outcome = await trash.restore([childRoot!.id, parentRoot!.id]);
    expect(outcome.failed).toEqual([]);
    expect(await taskModel.findById(child.id)).toMatchObject({ parentTaskId: parent.id });
  });

  it('stops a trashed dependency from blocking its dependents', async () => {
    const blocker = await createTask({ name: 'Blocker' });
    const dependent = await createTask({ name: 'Dependent' });
    await taskModel.addDependency(dependent.id, blocker.id);
    expect(await taskModel.areAllDependenciesCompleted(dependent.id)).toBe(false);

    await new TaskBatchService(db, userId).delete([blocker.id]);
    expect(await taskModel.areAllDependenciesCompleted(dependent.id)).toBe(true);

    // Restored, it blocks again: the dependency row survived in the bin.
    await trash.restore([(await rootOf(blocker.id))!.id]);
    expect(await taskModel.areAllDependenciesCompleted(dependent.id)).toBe(false);
  });

  it('purge removes the task and its topics for good, and frees its subtasks', async () => {
    const { task, topic } = await createTaskWithTopic();
    const child = await createTask({ name: 'Child', parentTaskId: task.id });
    await new TaskBatchService(db, userId).delete([task.id]);
    const root = await rootOf(task.id);

    const outcome = await trash.purge([root!.id]);

    expect(outcome.purged).toBe(1);
    expect(await rawTask(task.id)).toBeUndefined();
    expect(await rawTopic(topic.id)).toBeUndefined();
    expect(await taskModel.findById(child.id)).toMatchObject({ parentTaskId: null });
    expect(
      await db
        .select()
        .from(trashItems)
        .where(inArray(trashItems.resourceId, [task.id, topic.id])),
    ).toEqual([]);
  });

  it('keeps a topic trashed on its own as its own root', async () => {
    const { task, topic } = await createTaskWithTopic();
    await trash.trashTopics([topic.id]);

    await new TaskBatchService(db, userId).delete([task.id]);

    expect(await rootOf(task.id)).toMatchObject({
      meta: expect.objectContaining({ childCount: 0 }),
    });
    const { items } = await trash.list({ resourceType: 'topic' });
    expect(items.some((item) => item.resourceId === topic.id)).toBe(true);
  });

  it('hides a trashed task from recents, the home brief feed and the scheduler', async () => {
    const task = await createTask({
      automationMode: 'schedule',
      name: 'Nightly digest',
      schedulePattern: '0 2 * * *',
    });
    await new BriefModel(db, userId).create({
      summary: 'Ready for review',
      taskId: task.id,
      title: 'Digest',
      type: 'decision',
    });
    const recents = () => new RecentModel(db, userId).queryRecent(20, ['task']);
    const feed = () => new BriefModel(db, userId).listUnresolvedEnriched();
    const scheduled = async () =>
      (await TaskModel.getScheduledTasks(db)).filter((t) => t.id === task.id);
    expect((await recents()).some((item) => item.id === task.id)).toBe(true);
    expect((await feed()).some((row) => row.brief.taskId === task.id)).toBe(true);
    expect(await scheduled()).toHaveLength(1);

    await new TaskBatchService(db, userId).delete([task.id]);

    expect((await recents()).some((item) => item.id === task.id)).toBe(false);
    expect((await feed()).some((row) => row.brief.taskId === task.id)).toBe(false);
    // Its status is untouched in the bin, so the schedule filter alone must not pick it.
    expect(await scheduled()).toHaveLength(0);

    await trash.restore([(await rootOf(task.id))!.id]);
    expect((await recents()).some((item) => item.id === task.id)).toBe(true);
    expect(await scheduled()).toHaveLength(1);
  });
});
