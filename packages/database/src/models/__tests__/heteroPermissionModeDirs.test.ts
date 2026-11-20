// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaces, workspaceUserSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserModel } from '../user';
import { WorkspaceUserSettingsModel } from '../workspaceUserSettings';

const serverDB: LobeChatDatabase = await getTestDB();

const workspaceId = 'ws-permission-mode-test';
const userId = 'user-permission-mode-test';

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
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: 'ws-permission' });
});

afterEach(cleanup);

describe('UserModel.setHeteroPermissionModeDir', () => {
  const model = () => new UserModel(serverDB, userId);

  it('remembers the latest pick first, keeps other fields, and forgets the default', async () => {
    await model().setHeteroPermissionModeDir('d::/a', 'plan');
    expect(await model().setHeteroPermissionModeDir('d::/b', 'default')).toEqual([
      { key: 'd::/b', mode: 'default' },
      { key: 'd::/a', mode: 'plan' },
    ]);
    const user = await serverDB.query.users.findFirst({ where: eq(users.id, userId) });
    expect(user?.preference).toMatchObject({ topicGroupMode: 'byTime' });

    expect(await model().setHeteroPermissionModeDir('d::/a', 'bypassPermissions')).toEqual([
      { key: 'd::/b', mode: 'default' },
    ]);
  });
});

describe('WorkspaceUserSettingsModel.setHeteroPermissionModeDir', () => {
  const model = () => new WorkspaceUserSettingsModel(serverDB, userId, workspaceId);

  it('keeps the member list beside the worktree switch', async () => {
    await model().setWorktreeModeDir('d::/a', true);
    expect(await model().setHeteroPermissionModeDir('d::/a', 'acceptEdits')).toEqual([
      { key: 'd::/a', mode: 'acceptEdits' },
    ]);
    expect(await model().getPreference()).toMatchObject({
      heteroPermissionModeDirs: [{ key: 'd::/a', mode: 'acceptEdits' }],
      worktreeModeDirs: ['d::/a'],
    });
  });
});
