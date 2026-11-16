// @vitest-environment node
import { WORKTREE_MODE_DIRS_LIMIT } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaces, workspaceUserSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserModel } from '../user';
import { WorkspaceUserSettingsModel } from '../workspaceUserSettings';

const serverDB: LobeChatDatabase = await getTestDB();

const workspaceId = 'ws-worktree-mode-test';
const userId = 'user-worktree-mode-test';

const cleanup = async () => {
  await serverDB.delete(workspaceUserSettings);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values({ id: userId, preference: { topicGroupMode: 'byTime' } });
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: 'ws-worktree' });
});

afterEach(cleanup);

describe('UserModel.setWorktreeModeDir', () => {
  const model = () => new UserModel(serverDB, userId);
  const readPreference = async () =>
    (await serverDB.query.users.findFirst({ where: eq(users.id, userId) }))?.preference as Record<
      string,
      unknown
    >;

  it('stores directories switched on, newest first, and keeps other fields', async () => {
    await model().setWorktreeModeDir('d::/a', true);
    expect(await model().setWorktreeModeDir('d::/b', true)).toEqual(['d::/b', 'd::/a']);
    expect(await readPreference()).toMatchObject({
      topicGroupMode: 'byTime',
      worktreeModeDirs: ['d::/b', 'd::/a'],
    });
  });

  it('drops a directory switched off', async () => {
    await model().setWorktreeModeDir('d::/a', true);
    expect(await model().setWorktreeModeDir('d::/a', false)).toEqual([]);
  });

  it('survives a generic preference write', async () => {
    await model().setWorktreeModeDir('d::/a', true);
    await model().updatePreference({ topicSortBy: 'updatedAt' });
    expect((await readPreference()).worktreeModeDirs).toEqual(['d::/a']);
  });

  it('caps the list at the limit', async () => {
    await serverDB
      .update(users)
      .set({
        preference: {
          worktreeModeDirs: Array.from({ length: WORKTREE_MODE_DIRS_LIMIT }, (_, i) => `k${i}`),
        },
      })
      .where(eq(users.id, userId));

    const stored = await model().setWorktreeModeDir('newest', true);
    expect(stored).toHaveLength(WORKTREE_MODE_DIRS_LIMIT);
    expect(stored[0]).toBe('newest');
  });
});

describe('WorkspaceUserSettingsModel.setWorktreeModeDir', () => {
  const model = () => new WorkspaceUserSettingsModel(serverDB, userId, workspaceId);

  it('creates the row on first use and keeps sibling fields on later writes', async () => {
    expect(await model().setWorktreeModeDir('d::/a', true)).toEqual(['d::/a']);
    await model().updatePreference({ agentModeOverrides: { agentX: true } });
    expect(await model().setWorktreeModeDir('d::/b', true)).toEqual(['d::/b', 'd::/a']);

    expect(await model().getPreference()).toEqual({
      agentModeOverrides: { agentX: true },
      worktreeModeDirs: ['d::/b', 'd::/a'],
    });
  });

  it('keeps workspaces apart from the personal preference', async () => {
    await model().setWorktreeModeDir('d::/a', true);
    const user = await serverDB.query.users.findFirst({ where: eq(users.id, userId) });
    expect((user?.preference as Record<string, unknown>).worktreeModeDirs).toBeUndefined();
  });
});
