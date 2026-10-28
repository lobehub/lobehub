// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceModel } from '@/database/models/acceptance';
import { TaskModel } from '@/database/models/task';

import { acceptanceRouter } from '../../acceptance';
import { briefRouter } from '../../brief';
import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => testDB }));

let userId: string;
let model: TaskModel;
let caller: ReturnType<typeof taskRouter.createCaller>;
let briefs: ReturnType<typeof briefRouter.createCaller>;

beforeEach(async () => {
  testDB = await getTestDB();
  userId = await createTestUser(testDB);
  model = new TaskModel(testDB, userId);
  caller = taskRouter.createCaller(createTestContext(userId));
  briefs = briefRouter.createCaller(createTestContext(userId));
});
afterEach(async () => {
  await cleanupTestUser(testDB, userId);
});

describe('task ref boundaries', () => {
  it('lists children using parentTaskId as an identifier, including grouped lists', async () => {
    const parent = await model.create({ instruction: 'parent' });
    const child = await model.create({ instruction: 'child', parentTaskId: parent.id });
    expect((await caller.list({ parentTaskId: parent.identifier })).data.map((t) => t.id)).toEqual([
      child.id,
    ]);
    const groups = await caller.groupList({ parentTaskId: parent.identifier, groupBy: 'priority' });
    expect(JSON.stringify(groups.data)).toContain(child.id);
  });

  it('resolves a brief task ref before reading and writing its FK', async () => {
    const task = await model.create({ instruction: 'task' });
    const brief = await briefs.create({
      taskId: task.identifier,
      title: 'title',
      summary: 'summary',
      type: 'insight',
    });
    expect(brief.data.taskId).toBe(task.id);
    expect(
      (await briefs.findByTaskId({ taskId: task.identifier })).data.map((b) => b.id),
    ).toContain(brief.data.id);
  });

  it('returns NOT_FOUND for an unknown brief task instead of an FK error', async () => {
    await expect(
      briefs.create({ taskId: 'UNKNOWN-1', title: 'title', summary: 'summary', type: 'insight' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reorders mixed id and identifier refs and rejects duplicate aliases', async () => {
    const parent = await model.create({ instruction: 'parent' });
    const a = await model.create({ instruction: 'a', parentTaskId: parent.id });
    const b = await model.create({ instruction: 'b', parentTaskId: parent.id });
    const result = await caller.reorderSubtasks({ id: parent.id, order: [b.id, a.identifier] });
    expect(result.data.map((t) => t.id)).toEqual([b.id, a.id]);
    await expect(
      caller.reorderSubtasks({ id: parent.id, order: [a.id, a.identifier] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('maps acceptance statuses back to requested refs and includes historical identifier subjects', async () => {
    const task = await model.create({ instruction: 'task' });
    const acceptances = new AcceptanceModel(testDB, userId);
    await acceptances.ensureForSubject('task', task.identifier);
    const caller = acceptanceRouter.createCaller(createTestContext(userId));
    const result = await caller.listStatusesBySubjects({
      subjectType: 'task',
      subjectIds: [task.id, task.identifier.toLowerCase()],
    });
    expect(result).toEqual([
      { status: 'pending', subjectId: task.id },
      { status: 'pending', subjectId: task.identifier.toLowerCase() },
    ]);
  });

  it('dual-writes checkpoint identifiers and stable pairs, collapsing aliases', async () => {
    const parent = await model.create({ instruction: 'parent' });
    const child = await model.create({ instruction: 'child', parentTaskId: parent.id });
    await caller.updateCheckpoint({
      id: parent.id,
      checkpoint: { tasks: { beforeIds: [child.identifier, child.id] } },
    });
    const stored = await model.findById(parent.id);
    expect(model.getCheckpointConfig(stored!).tasks).toEqual({
      beforeIds: [child.identifier],
      beforeTasks: [{ id: child.id, identifier: child.identifier }],
    });
  });
});
