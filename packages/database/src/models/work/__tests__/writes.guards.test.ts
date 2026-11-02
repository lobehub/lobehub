// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { reassignTaskWorksOwner } from '../writes';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'work-writes-guards-user';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reassignTaskWorksOwner guards', () => {
  it('reassigns nothing when the handover carries no task', async () => {
    const update = vi.spyOn(serverDB, 'update');

    await expect(
      reassignTaskWorksOwner({ db: serverDB, userId, workspaceId: 'ws-1' }, [], 'previous-owner'),
    ).resolves.toBeUndefined();

    expect(update).not.toHaveBeenCalled();
  });

  it('reassigns nothing outside a workspace, where the previous creator is not a known member', async () => {
    // The caller is authorized on the tasks, not on the previous creator's Work
    // rows, so an unscoped handover would move rows the caller cannot see.
    const update = vi.spyOn(serverDB, 'update');

    await expect(
      reassignTaskWorksOwner({ db: serverDB, userId }, ['task-1'], 'previous-owner'),
    ).resolves.toBeUndefined();

    expect(update).not.toHaveBeenCalled();
  });
});
