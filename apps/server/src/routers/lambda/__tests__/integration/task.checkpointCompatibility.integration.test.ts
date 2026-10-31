// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { tasks } from '@/database/schemas/task';

import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => testDB }));
let userId: string;
let model: TaskModel;
let caller: ReturnType<typeof taskRouter.createCaller>;
beforeEach(async () => {
  testDB = await getTestDB();
  userId = await createTestUser(testDB);
  model = new TaskModel(testDB, userId);
  caller = taskRouter.createCaller(createTestContext(userId));
});
afterEach(async () => {
  await cleanupTestUser(testDB, userId);
});

const fixture = async () => {
  const parent = await model.create({ instruction: 'parent' });
  const a = await model.create({ instruction: 'a', parentTaskId: parent.id });
  const b = await model.create({ instruction: 'b', parentTaskId: parent.id });
  return { parent, a, b };
};

describe('checkpoint mixed-version compatibility', () => {
  it.each(['updateCheckpoint', 'update', 'updateConfig', 'configPatch'] as const)(
    'preserves unchanged legacy selections after a child is deleted through %s',
    async (entry) => {
      const { parent, a } = await fixture();
      const tasks = { beforeIds: [a.identifier], afterIds: [a.identifier] };
      await model.updateCheckpointConfig(parent.id, { tasks });
      await model.delete(a.id);
      const checkpoint = { tasks, topic: { before: true } };
      if (entry === 'updateCheckpoint') {
        await caller.updateCheckpoint({ id: parent.id, checkpoint });
      } else if (entry === 'updateConfig') {
        await caller.updateConfig({ id: parent.id, config: { checkpoint } });
      } else {
        await caller.update({
          id: parent.id,
          ...(entry === 'configPatch'
            ? { configPatch: { checkpoint } }
            : { config: { checkpoint } }),
        });
      }
      expect(model.getCheckpointConfig((await model.findById(parent.id))!)).toEqual(checkpoint);
      await expect(
        caller.updateCheckpoint({
          id: parent.id,
          checkpoint: { tasks: { beforeIds: ['MISSING-NEW'] } },
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    },
  );

  it('dual-writes canonical labels and stable pairs, so an old reader still pauses', async () => {
    const { parent, a } = await fixture();
    await caller.updateCheckpoint({
      id: parent.id,
      checkpoint: {
        tasks: {
          beforeIds: [a.id, a.identifier.toLowerCase()],
          afterIds: [a.identifier.toLowerCase(), a.id],
        },
      },
    });
    const stored = (await model.findById(parent.id))!;
    const checkpoint = model.getCheckpointConfig(stored);
    expect(checkpoint.tasks).toEqual({
      beforeIds: [a.identifier],
      beforeTasks: [{ id: a.id, identifier: a.identifier }],
      afterIds: [a.identifier],
      afterTasks: [{ id: a.id, identifier: a.identifier }],
    });
    // The exact canary read rule, without the new fields.
    expect(checkpoint.tasks?.beforeIds?.includes(a.identifier)).toBe(true);
    expect(checkpoint.tasks?.afterIds?.includes(a.identifier)).toBe(true);
    expect(model.shouldPauseBeforeStart(stored, a)).toBe(true);
    expect(model.shouldPauseAfterComplete(stored, a)).toBe(true);
  });

  it('honors old-writer array replacement even while stale pairs survive deep merge', async () => {
    const { parent, a, b } = await fixture();
    await caller.updateCheckpoint({
      id: parent.id,
      checkpoint: { tasks: { beforeIds: [a.id], afterIds: [a.id] } },
    });
    await model.updateTaskConfig(parent.id, {
      checkpoint: { tasks: { beforeIds: [b.identifier], afterIds: [] } },
    });
    const stored = (await model.findById(parent.id))!;
    expect(model.getCheckpointConfig(stored).tasks).toMatchObject({
      beforeTasks: [{ id: a.id, identifier: a.identifier }],
      afterTasks: [{ id: a.id, identifier: a.identifier }],
    });
    expect(model.shouldPauseBeforeStart(stored, a)).toBe(false);
    expect(model.shouldPauseBeforeStart(stored, b)).toBe(true);
    expect(model.shouldPauseAfterComplete(stored, a)).toBe(false);
  });

  it('preserves consistent pairs across rename, alias reuse and a whole-config round trip', async () => {
    const { parent, a, b } = await fixture();
    const checkpoint = {
      tasks: {
        beforeIds: [a.identifier],
        beforeTasks: [{ id: a.id, identifier: a.identifier }],
        afterIds: [a.identifier],
        afterTasks: [{ id: a.id, identifier: a.identifier }],
      },
    };
    await model.updateTaskConfig(parent.id, { checkpoint });
    await testDB.update(tasks).set({ identifier: 'REN-1' }).where(eq(tasks.id, a.id));
    await testDB.update(tasks).set({ identifier: a.identifier }).where(eq(tasks.id, b.id));
    await caller.updateCheckpoint({ id: parent.id, checkpoint });
    await caller.updateConfig({ id: parent.id, config: { checkpoint } });
    await caller.update({ id: parent.id, config: { checkpoint } });
    const stored = (await model.findById(parent.id))!;
    expect(model.getCheckpointConfig(stored)).toEqual(checkpoint);
    expect(model.shouldPauseBeforeStart(stored, { ...a, identifier: 'REN-1' })).toBe(true);
    expect(model.shouldPauseBeforeStart(stored, { ...b, identifier: a.identifier })).toBe(false);
    expect(model.shouldPauseAfterComplete(stored, { ...a, identifier: 'REN-1' })).toBe(true);
    const result = (await caller.getCheckpoint({ id: parent.id })).data;
    expect(result.tasks).toEqual(checkpoint.tasks);
    expect(result.beforeTasks).toEqual([{ id: a.id, identifier: 'REN-1' }]);
  });

  it('keeps exact legacy matching, including inactive lowercase and raw id values', async () => {
    const { parent, a } = await fixture();
    await model.updateCheckpointConfig(parent.id, {
      tasks: { beforeIds: [a.identifier], afterIds: [a.identifier] },
    });
    const stored = (await model.findById(parent.id))!;
    expect(model.shouldPauseBeforeStart(stored, a)).toBe(true);
    expect(model.shouldPauseAfterComplete(stored, a)).toBe(true);
    await model.updateCheckpointConfig(parent.id, {
      tasks: { beforeIds: [a.identifier.toLowerCase()], afterIds: [a.id] },
    });
    const inactive = (await model.findById(parent.id))!;
    expect(model.shouldPauseBeforeStart(inactive, a)).toBe(false);
    expect(model.shouldPauseAfterComplete(inactive, a)).toBe(false);
  });

  it.each(['create', 'update', 'updateConfig', 'configPatch'] as const)(
    'dual-writes free config through %s',
    async (entry) => {
      const { parent, a } = await fixture();
      const config = { checkpoint: { tasks: { beforeIds: [a.id, a.identifier.toLowerCase()] } } };
      const result =
        entry === 'create'
          ? await caller.create({ instruction: 'new parent', config })
          : entry === 'updateConfig'
            ? await caller.updateConfig({ id: parent.id, config })
            : await caller.update({
                id: parent.id,
                ...(entry === 'configPatch' ? { configPatch: config } : { config }),
              });
      const stored = (await model.findById(result.data!.id))!;
      expect(model.getCheckpointConfig(stored).tasks).toEqual({
        beforeIds: [a.identifier],
        beforeTasks: [{ id: a.id, identifier: a.identifier }],
      });
    },
  );

  it('reports every missing ref as NOT_FOUND before changing config', async () => {
    const { parent } = await fixture();
    await expect(
      caller.updateCheckpoint({
        id: parent.id,
        checkpoint: { tasks: { beforeIds: ['MISSING-1'], afterIds: ['task_missing'] } },
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('MISSING-1, task_missing'),
    });
    await expect(
      caller.updateCheckpoint({
        id: parent.id,
        checkpoint: { tasks: { afterIds: ['MISSING-2'] } },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('MISSING-2') });
    expect(model.getCheckpointConfig((await model.findById(parent.id))!)).toEqual({});
  });
});
