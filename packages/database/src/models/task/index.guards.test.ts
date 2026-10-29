// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { taskActivities, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { columnIndex, createProxyTestDB } from '../__tests__/_proxyTestDB';
import { TaskModel } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-index-guards-user';
const model = new TaskModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('TaskModel.resolve ambiguity guard', () => {
  it('refuses to pick one of two tasks that answer the same identifier', async () => {
    const task = await model.create({ instruction: 'only task' });
    // Two rows behind one identifier: what the lookup would see if the per-scope unique
    // index (tasks_identifier_idx) were dropped or the scope predicate widened.
    const duplicating = new TaskModel(
      createProxyTestDB(serverDB, (query, result) => {
        if (!query.startsWith('select') || !query.includes('from "tasks"')) return result.rows;
        const id = columnIndex(result, 'id');
        return result.rows.flatMap((row) => {
          const twin = [...row];
          twin[id] = `${row[id]}-twin`;
          return [row, twin];
        });
      }),
      userId,
    );

    await expect(duplicating.resolve(task.identifier)).rejects.toThrow(
      `Ambiguous task reference: ${task.identifier}`,
    );
    // The same ref against the real rows resolves to the one task.
    expect((await model.resolve(task.identifier))?.id).toBe(task.id);
  });
});

describe('TaskModel.updateWithLog write guard', () => {
  it('returns null and logs nothing when the locked write comes back empty', async () => {
    const task = await model.create({ instruction: 'locked task', priority: 1 });
    // The scoped write inside the transaction reports no row, as if the locked row had
    // left the caller's scope between the lock and the write.
    const write = vi.spyOn(TaskModel.prototype, 'update').mockResolvedValue(null);

    const result = await model.updateWithLog(task.id, { priority: 3 }, { userId });

    // The locked path ran: the write inside the transaction was attempted with the new value.
    expect(write).toHaveBeenCalledWith(task.id, { priority: 3 });
    expect(result).toBeNull();
    vi.restoreAllMocks();
    expect((await model.findById(task.id))?.priority).toBe(1);
    expect(
      await serverDB.select().from(taskActivities).where(eq(taskActivities.taskId, task.id)),
    ).toEqual([]);
  });
});
