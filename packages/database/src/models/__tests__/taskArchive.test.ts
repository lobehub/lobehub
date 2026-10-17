// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { TaskArchiveModel } from '../taskArchive';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-archive-model-test-user-id';
const otherUserId = 'task-archive-model-test-other-user-id';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TaskArchiveModel', () => {
  it('archives an idle task once and keeps the first timestamp', async () => {
    const tasks = new TaskModel(serverDB, userId);
    const model = new TaskArchiveModel(serverDB, userId);
    const task = await tasks.create({ instruction: 'Idle task' });

    const first = await model.archive(task.id);
    expect(first?.archivedAt).toBeInstanceOf(Date);

    const again = await model.archive(task.id);
    expect(again?.archivedAt).toEqual(first?.archivedAt);
    expect(again?.status).toBe('backlog');
  });

  it('refuses a running task in the same statement', async () => {
    const tasks = new TaskModel(serverDB, userId);
    const model = new TaskArchiveModel(serverDB, userId);
    const task = await tasks.create({ instruction: 'Running task' });
    await tasks.updateStatus(task.id, 'running');

    expect(await model.archive(task.id)).toBeNull();
    expect((await tasks.findById(task.id))?.archivedAt).toBeNull();
  });

  it('refuses a schedule that can still fire, but not one that is finished', async () => {
    const tasks = new TaskModel(serverDB, userId);
    const model = new TaskArchiveModel(serverDB, userId);
    const live = await tasks.create({
      automationMode: 'schedule',
      instruction: 'Live schedule',
      schedulePattern: '0 9 * * *',
    });
    const done = await tasks.create({
      automationMode: 'schedule',
      instruction: 'Finished schedule',
      schedulePattern: '0 9 * * *',
    });
    await tasks.updateStatus(done.id, 'completed', { completedAt: new Date() });

    expect(await model.archive(live.id)).toBeNull();
    expect((await model.archive(done.id))?.archivedAt).toBeInstanceOf(Date);
  });

  it('archives a paused schedule but not a paused heartbeat', async () => {
    const tasks = new TaskModel(serverDB, userId);
    const model = new TaskArchiveModel(serverDB, userId);
    const schedule = await tasks.create({
      automationMode: 'schedule',
      instruction: 'Paused schedule',
      schedulePattern: '0 9 * * *',
    });
    const heartbeat = await tasks.create({
      automationMode: 'heartbeat',
      heartbeatInterval: 600,
      instruction: 'Paused heartbeat',
    });
    await tasks.updateStatus(schedule.id, 'paused');
    await tasks.updateStatus(heartbeat.id, 'paused');

    expect((await model.archive(schedule.id))?.archivedAt).toBeInstanceOf(Date);
    expect(await model.archive(heartbeat.id)).toBeNull();
  });

  it('lists an archived paused schedule with the ordinary tasks, not the scheduled ones', async () => {
    const tasks = new TaskModel(serverDB, userId);
    const model = new TaskArchiveModel(serverDB, userId);
    const schedule = await tasks.create({
      automationMode: 'schedule',
      instruction: 'Paused schedule',
      schedulePattern: '0 9 * * *',
    });
    await tasks.updateStatus(schedule.id, 'paused');
    await model.archive(schedule.id);

    const ordinary = await tasks.list({ automated: false, includeArchived: true });
    expect(ordinary.tasks.map((task) => task.id)).toEqual([schedule.id]);
    const scheduled = await tasks.list({ automated: true, includeArchived: true });
    expect(scheduled.tasks).toEqual([]);
  });

  it('unarchives regardless of state', async () => {
    const tasks = new TaskModel(serverDB, userId);
    const model = new TaskArchiveModel(serverDB, userId);
    const task = await tasks.create({ instruction: 'Archived task' });
    await model.archive(task.id);

    const restored = await model.unarchive(task.id);
    expect(restored?.archivedAt).toBeNull();
  });

  it("cannot touch another user's task", async () => {
    const task = await new TaskModel(serverDB, otherUserId).create({ instruction: 'Not mine' });

    expect(await new TaskArchiveModel(serverDB, userId).archive(task.id)).toBeNull();
    expect(await new TaskArchiveModel(serverDB, userId).unarchive(task.id)).toBeNull();
  });
});
