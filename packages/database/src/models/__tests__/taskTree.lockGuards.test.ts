// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { LobeChatDatabase } from '../../type';
import { lockWholeSubtree, takeOverSubtree } from '../task/tree';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-tree-guards-user';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('task subtree helpers without a workspace', () => {
  it('locks nothing when the subtree lives in personal scope', async () => {
    // The recursive lock is scoped by `workspace_id`; a personal task has no
    // subtree to lock and must not fall through to an unscoped `FOR UPDATE`.
    const execute = vi.spyOn(serverDB, 'execute');

    await expect(
      lockWholeSubtree({ db: serverDB, userId }, 'task-without-workspace'),
    ).resolves.toEqual([]);

    expect(execute).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no subtree to take over', async () => {
    const update = vi.spyOn(serverDB, 'update');

    await expect(takeOverSubtree({ db: serverDB, userId }, [])).resolves.toBeUndefined();

    expect(update).not.toHaveBeenCalled();
  });
});
