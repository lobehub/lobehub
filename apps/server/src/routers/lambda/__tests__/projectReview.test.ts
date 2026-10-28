// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { workspaceMembers, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectModel } from '@/database/models/project';

import { projectReviewRouter } from '../projectReview';
import { cleanupTestUser, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));
describe('projectReviewRouter', () => {
  let ownerId: string;
  let strangerId: string;
  let memberId: string;
  let projectId: string;

  const caller = (userId: string) =>
    projectReviewRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  beforeEach(async () => {
    testDB = await getTestDB();
    ownerId = await createTestUser(testDB);
    strangerId = await createTestUser(testDB);
    memberId = await createTestUser(testDB);
    const [workspace] = await testDB
      .insert(workspaces)
      .values({ name: 'Fieldnotes', primaryOwnerId: ownerId, slug: ownerId })
      .returning();
    await testDB.insert(workspaceMembers).values([
      { workspaceId: workspace.id, userId: ownerId, role: 'owner' },
      { workspaceId: workspace.id, userId: memberId },
    ]);
    projectId = (
      await new ProjectModel(testDB, ownerId, workspace.id).create({
        identifier: 'SITE',
        name: 'Fieldnotes',
      })
    ).id;
  });

  afterEach(async () => {
    await cleanupTestUser(testDB, memberId);
    await cleanupTestUser(testDB, strangerId);
    await cleanupTestUser(testDB, ownerId);
  });

  it('creates and lists sites for a manager', async () => {
    const site = await caller(ownerId).createSite({
      name: 'Marketing site',
      origins: ['https://fieldnotes.app'],
      projectId,
    });
    expect(site.id).toMatch(/^psite_/);
    expect(await caller(ownerId).listSites({ projectId })).toEqual([
      expect.objectContaining({ id: site.id }),
    ]);
  });

  it('sets and clears a workspace member project role', async () => {
    await caller(ownerId).setMemberRole({ userId: memberId, projectId, role: 'viewer' });
    expect(await caller(ownerId).listMembers({ projectId })).toMatchObject({
      members: [expect.objectContaining({ userId: memberId, role: 'viewer' })],
    });
    await caller(ownerId).setMemberRole({ userId: memberId, projectId, role: 'admin' });
    await expect(caller(memberId).listMembers({ projectId })).resolves.toBeTruthy();
    await caller(ownerId).setMemberRole({ userId: memberId, projectId, role: null });
    expect((await caller(ownerId).listMembers({ projectId })).members).toEqual([]);
  });

  it('rejects a user outside the project workspace', async () => {
    await expect(
      caller(ownerId).setMemberRole({ userId: strangerId, projectId, role: 'member' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a stranger', async () => {
    await expect(caller(strangerId).listSites({ projectId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects an unknown role', async () => {
    await expect(
      caller(ownerId).setMemberRole({ userId: memberId, projectId, role: 'owner' as any }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
