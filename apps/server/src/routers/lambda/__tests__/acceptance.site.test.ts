// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { workspaceMembers, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectModel } from '@/database/models/project';
import { ProjectReviewService } from '@/server/services/projectReview';

import { acceptanceRouter } from '../acceptance';
import { cleanupTestUser, createTestUser } from './integration/setup';

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => serverDB }));
describe('acceptanceRouter on a site review', () => {
  let ownerId: string;
  let adminId: string;
  let memberId: string;
  let projectId: string;
  let acceptanceId: string;

  const caller = (userId: string) =>
    acceptanceRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  beforeEach(async () => {
    serverDB = await getTestDB();
    ownerId = await createTestUser(serverDB);
    adminId = await createTestUser(serverDB);
    memberId = await createTestUser(serverDB);
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'Fieldnotes', primaryOwnerId: ownerId, slug: `ws-${ownerId}` })
      .returning();
    await serverDB.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId: workspace.id },
      { role: 'admin', userId: adminId, workspaceId: workspace.id },
      { role: 'member', userId: memberId, workspaceId: workspace.id },
    ]);
    const project = await new ProjectModel(serverDB, ownerId, workspace.id).create({
      identifier: 'SITE',
      name: 'Fieldnotes site',
    });
    projectId = project.id;
    const site = await new ProjectReviewService(serverDB, adminId).createSite(projectId, {
      name: 'Marketing site',
      origins: ['https://fieldnotes.app'],
    });
    acceptanceId = site.acceptanceId!;
  });

  afterEach(async () => {
    for (const id of [memberId, adminId, ownerId]) await cleanupTestUser(serverDB, id);
  });

  it('shows the site review to the project but never offers a decision', async () => {
    const bundle = await caller(ownerId).getBundle({ id: acceptanceId });
    expect(bundle.canReview).toBe(false);
  });

  it('refuses decisions, visibility changes and deletion even to the person who created the site', async () => {
    await expect(
      caller(adminId).setVisibility({ id: acceptanceId, visibility: 'public' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller(adminId).remove({ id: acceptanceId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller(ownerId).rename({ id: acceptanceId, title: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller(ownerId).accept({ id: acceptanceId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller(ownerId).reject({ id: acceptanceId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('inherits workspace access and applies the project role override', async () => {
    const service = new ProjectReviewService(serverDB, ownerId);
    await expect(caller(memberId).getBundle({ id: acceptanceId })).resolves.toBeTruthy();
    await service.setMemberRole(projectId, memberId, 'viewer');
    await expect(caller(memberId).getBundle({ id: acceptanceId })).resolves.toBeTruthy();
    await service.setMemberRole(projectId, memberId, null);
    await expect(caller(memberId).getBundle({ id: acceptanceId })).resolves.toBeTruthy();
    await expect(caller(adminId).getBundle({ id: acceptanceId })).resolves.toBeTruthy();
  });
});
