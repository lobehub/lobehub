// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { users } from '@/database/schemas';

import { TaskBatchService } from './batch';
import { TaskBatchRevertService } from './batchRevert';

vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({ deleteFile: vi.fn(), deleteFiles: vi.fn() })),
}));

const userId = 'task-batch-revert-user';
const actor = { agentId: null, userId };

// Module-level: the first call migrates a fresh database, which can outlast a
// hook timeout on a loaded CI shard.
const db: LobeChatDatabase = await getTestDB();

describe('TaskBatchRevertService (real PostgreSQL)', () => {
  let model: TaskModel;
  let batch: TaskBatchService;
  let revert: TaskBatchRevertService;

  beforeEach(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await db.insert(users).values({ id: userId });
    model = new TaskModel(db, userId);
    batch = new TaskBatchService(db, userId);
    revert = new TaskBatchRevertService(db, userId);
  });

  afterEach(async () => {
    await db.delete(users).where(eq(users.id, userId));
  });

  const create = (data: Record<string, unknown> = {}) =>
    model.create({ instruction: 'Do it', ...data });

  it('puts each task back to its own previous status, not one shared value', async () => {
    const a = await create();
    const b = await create();
    await model.updateStatus(b.id, 'paused');

    const { result } = await batch.updateStatus([a.id, b.id], 'completed', actor);
    expect(result.reverts).toEqual(
      expect.arrayContaining([
        { after: { status: 'completed' }, before: { status: 'backlog' }, id: a.id },
        { after: { status: 'completed' }, before: { status: 'paused' }, id: b.id },
      ]),
    );

    const undone = await revert.revert(result.reverts!, actor);

    expect(undone.updated.sort()).toEqual([a.id, b.id].sort());
    expect((await model.findById(a.id))?.status).toBe('backlog');
    expect((await model.findById(b.id))?.status).toBe('paused');
  });

  it('leaves a task someone changed again since the batch alone', async () => {
    const a = await create();
    const b = await create();
    const { result } = await batch.updateStatus([a.id, b.id], 'completed', actor);
    await model.updateStatus(b.id, 'canceled');

    const undone = await revert.revert(result.reverts!, actor);

    expect(undone.updated).toEqual([a.id]);
    expect(undone.skipped).toEqual([{ id: b.id, reason: 'conflict' }]);
    expect((await model.findById(b.id))?.status).toBe('canceled');
  });

  it('restores per-task priorities and assignees', async () => {
    const a = await create({ priority: 1 });
    const b = await create({ priority: 3 });

    const { result } = await batch.updateFields([a.id, b.id], { priority: 4 }, actor);
    const undone = await revert.revert(result.reverts!, actor);

    expect(undone.updated.sort()).toEqual([a.id, b.id].sort());
    expect((await model.findById(a.id))?.priority).toBe(1);
    expect((await model.findById(b.id))?.priority).toBe(3);
  });

  it('undoes an archive by restoring the tasks to the lists', async () => {
    const a = await create();
    const archived = await batch.archive([a.id], true);
    expect(archived.reverts).toEqual([
      { after: { archived: true }, before: { archived: false }, id: a.id },
    ]);

    const undone = await revert.revert(archived.reverts!, actor);

    expect(undone.updated).toEqual([a.id]);
    expect((await model.findById(a.id))?.archivedAt).toBeNull();
  });

  it('undoes a delete by bringing the tasks back out of the recycle bin', async () => {
    const a = await create();
    const b = await create();
    await batch.delete([a.id, b.id]);
    expect(await model.findById(a.id)).toBeNull();

    const undone = await revert.restoreDeleted([a.id, b.id, 'task_missing']);

    expect(undone.updated.sort()).toEqual([a.id, b.id].sort());
    expect(undone.skipped).toEqual([{ id: 'task_missing', reason: 'notFound' }]);
    expect(await model.findById(a.id)).not.toBeNull();
    expect(await model.findById(b.id)).not.toBeNull();
  });
});
