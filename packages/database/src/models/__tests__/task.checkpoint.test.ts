// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import { TaskModel } from '../task';

const serverDB = await getTestDB();
const userId = 'task-checkpoint-user';
beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
});
afterEach(async () => {
  await serverDB.delete(users);
});
describe('checkpoint', () => {
  it('should get and update checkpoint config', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'Test' });

    // Initially empty
    const empty = model.getCheckpointConfig(task);
    expect(empty).toEqual({});

    // Set checkpoint
    const updated = await model.updateCheckpointConfig(task.id, {
      onAgentRequest: true,
      tasks: { afterIds: ['T-2'], beforeIds: ['T-3'] },
      topic: { after: true },
    });

    const config = model.getCheckpointConfig(updated!);
    expect(config.onAgentRequest).toBe(true);
    expect(config.topic?.after).toBe(true);
    expect(config.tasks?.beforeIds).toEqual(['T-3']);
    expect(config.tasks?.afterIds).toEqual(['T-2']);
  });

  it('should check shouldPauseBeforeStart', async () => {
    const model = new TaskModel(serverDB, userId);
    const parent = await model.create({ instruction: 'Parent' });

    await model.updateCheckpointConfig(parent.id, {
      tasks: { beforeIds: ['T-5'] },
    });

    const parentUpdated = (await model.findById(parent.id))!;
    expect(
      model.shouldPauseBeforeStart(parentUpdated, { id: 'task_unused', identifier: 'T-5' }),
    ).toBe(true);
    expect(
      model.shouldPauseBeforeStart(parentUpdated, { id: 'task_unused', identifier: 'T-6' }),
    ).toBe(false);
  });

  it('should pause on topic complete by default (no config)', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'Test' });

    // No checkpoint configured → should pause (default behavior)
    expect(model.shouldPauseOnTopicComplete(task)).toBe(true);
  });

  it('should pause on topic complete when topic.after is true', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'Test' });

    await model.updateCheckpointConfig(task.id, {
      topic: { after: true },
    });

    const updated = (await model.findById(task.id))!;
    expect(model.shouldPauseOnTopicComplete(updated)).toBe(true);
  });

  it('should not pause on topic complete when only onAgentRequest is set', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'Test' });

    await model.updateCheckpointConfig(task.id, {
      onAgentRequest: true,
    });

    const updated = (await model.findById(task.id))!;
    // Has explicit config but topic.after is not true → don't auto-pause
    expect(model.shouldPauseOnTopicComplete(updated)).toBe(false);
  });

  it('should not pause on topic complete when topic.after is false', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'Test' });

    await model.updateCheckpointConfig(task.id, {
      topic: { after: false },
    });

    const updated = (await model.findById(task.id))!;
    expect(model.shouldPauseOnTopicComplete(updated)).toBe(false);
  });

  it('should check shouldPauseAfterComplete', async () => {
    const model = new TaskModel(serverDB, userId);
    const parent = await model.create({ instruction: 'Parent' });

    await model.updateCheckpointConfig(parent.id, {
      tasks: { afterIds: ['T-2', 'T-3'] },
    });

    const parentUpdated = (await model.findById(parent.id))!;
    expect(
      model.shouldPauseAfterComplete(parentUpdated, { id: 'task_unused', identifier: 'T-2' }),
    ).toBe(true);
    expect(
      model.shouldPauseAfterComplete(parentUpdated, { id: 'task_unused', identifier: 'T-3' }),
    ).toBe(true);
    expect(
      model.shouldPauseAfterComplete(parentUpdated, { id: 'task_unused', identifier: 'T-4' }),
    ).toBe(false);
  });
});
