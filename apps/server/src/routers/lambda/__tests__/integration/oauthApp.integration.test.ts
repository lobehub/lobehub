// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { oauthAppRouter } from '../../oauthApp';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

describe('OAuth app router integration', () => {
  const userId = 'oauth-app-router-user';
  const memberId = 'oauth-app-router-member';
  const workspaceId = 'oauth-app-router-workspace';
  const otherWorkspaceId = 'oauth-app-router-other-workspace';

  beforeEach(async () => {
    testDB = await getTestDB();
    await createTestUser(testDB, userId);
    await createTestUser(testDB, memberId);
    await testDB.insert(workspaces).values([
      {
        id: workspaceId,
        name: 'OAuth App Router Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      },
      {
        id: otherWorkspaceId,
        name: 'OAuth App Router Other Workspace',
        primaryOwnerId: memberId,
        slug: otherWorkspaceId,
      },
    ]);
    await testDB.insert(workspaceMembers).values([
      { role: 'owner', userId, workspaceId },
      { role: 'member', userId: memberId, workspaceId },
      { role: 'owner', userId: memberId, workspaceId: otherWorkspaceId },
    ]);
  });

  afterEach(async () => {
    await cleanupTestUser(testDB, userId);
    await cleanupTestUser(testDB, memberId);
  });

  it('creates and isolates personal and workspace OAuth apps', async () => {
    const personalCaller = oauthAppRouter.createCaller(createTestContext(userId));
    const workspaceCaller = oauthAppRouter.createCaller({
      ...createTestContext(userId),
      workspaceId,
    });
    const memberCaller = oauthAppRouter.createCaller({
      ...createTestContext(memberId),
      workspaceId,
    });
    const otherWorkspaceCaller = oauthAppRouter.createCaller({
      ...createTestContext(memberId),
      workspaceId: otherWorkspaceId,
    });

    const personalApp = await personalCaller.create({ name: 'Personal App' });
    const workspaceApp = await workspaceCaller.create({ name: 'Workspace App' });

    expect(personalApp).toMatchObject({ name: 'Personal App', userId, workspaceId: null });
    expect(workspaceApp).toMatchObject({ name: 'Workspace App', userId, workspaceId });
    await expect(personalCaller.list()).resolves.toMatchObject([{ id: personalApp.id }]);
    await expect(memberCaller.list()).resolves.toMatchObject([{ id: workspaceApp.id }]);
    await expect(otherWorkspaceCaller.list()).resolves.toEqual([]);
    await expect(personalCaller.getById({ id: workspaceApp.id })).resolves.toBeUndefined();
  });
});
