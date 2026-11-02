// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { tasks, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-identifier-test-user-id';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TaskModel.create identifier allocation', () => {
  // Callers such as Quick Note proposal apply create tasks inside their own transaction.
  // A failed identifier insert must not abort that outer transaction.
  it('keeps the caller transaction usable after an identifier conflict', async () => {
    const result = await serverDB.transaction(async (tx) => {
      // seq 1 owns identifier T-2, so the next allocated identifier always conflicts.
      await tx.insert(tasks).values({
        createdByUserId: userId,
        identifier: 'T-2',
        instruction: 'existing',
        seq: 1,
      });

      await expect(
        new TaskModel(tx as unknown as LobeChatDatabase, userId).create(
          { instruction: 'conflicting' },
          { maxRetries: 2 },
        ),
      ).rejects.toThrow();

      return tx.select({ identifier: tasks.identifier }).from(tasks);
    });

    expect(result.map((row) => row.identifier)).toEqual(['T-2']);
  });

  it('allocates the next identifier in the caller transaction', async () => {
    const task = await serverDB.transaction(async (tx) =>
      new TaskModel(tx as unknown as LobeChatDatabase, userId).create({ instruction: 'first' }),
    );

    expect(task.identifier).toBe('T-1');
    expect(task.seq).toBe(1);
  });
});
