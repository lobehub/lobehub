// @vitest-environment node
import { WORKSPACE_SYSTEM_ROLES } from '@lobechat/const/rbac';
import { type LobeChatDatabase } from '@lobechat/database';
import { topics, workspaceAuditLogs, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RbacModel } from '@/database/models/rbac';
import { seedWorkspaceRoles } from '@/database/utils/seedWorkspaceRoles';

import { topicRouter } from '../../topic';
import { cleanupTestUser, createTestUser } from './setup';

// Mock FileService to avoid S3 initialization issues in tests
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockResolvedValue('mock-url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const createWorkspaceContext = (userId: string, workspaceId?: string) => ({
  jwtPayload: { userId },
  userId,
  workspaceId,
});

describe('Topic Share Router Integration Tests (workspace permission matrix)', () => {
  let serverDB: LobeChatDatabase;
  let creatorId: string;
  let memberId: string;
  let ownerId: string;
  let workspaceId: string;
  let topicId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;

    creatorId = await createTestUser(serverDB);
    memberId = await createTestUser(serverDB);
    ownerId = await createTestUser(serverDB);

    const [workspace] = await serverDB
      .insert(workspaces)
      .values({
        name: 'Share Perm WS',
        primaryOwnerId: ownerId,
        slug: `share-perm-ws-${creatorId.slice(0, 8)}`,
      })
      .returning();
    workspaceId = workspace.id;

    await seedWorkspaceRoles(serverDB, workspaceId);
    const rbac = new RbacModel(serverDB, creatorId);
    await rbac.assignWorkspaceRole({
      roleName: WORKSPACE_SYSTEM_ROLES.MEMBER,
      userId: creatorId,
      workspaceId,
    });
    await rbac.assignWorkspaceRole({
      roleName: WORKSPACE_SYSTEM_ROLES.MEMBER,
      userId: memberId,
      workspaceId,
    });
    await rbac.assignWorkspaceRole({
      roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
      userId: ownerId,
      workspaceId,
    });

    const [topic] = await serverDB
      .insert(topics)
      .values({ title: 'WS Perm Topic', userId: creatorId, workspaceId })
      .returning();
    topicId = topic.id;
  });

  afterEach(async () => {
    await serverDB
      .delete(workspaceAuditLogs)
      .where(eq(workspaceAuditLogs.workspaceId, workspaceId));
    await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await cleanupTestUser(serverDB, creatorId);
    await cleanupTestUser(serverDB, memberId);
    await cleanupTestUser(serverDB, ownerId);
  });

  const auditRows = () =>
    serverDB.query.workspaceAuditLogs.findMany({
      where: eq(workspaceAuditLogs.workspaceId, workspaceId),
    });

  describe('management permission: creator + workspace owner only', () => {
    it('creator can enable and switch their own share', async () => {
      const caller = topicRouter.createCaller(createWorkspaceContext(creatorId, workspaceId));

      const created = await caller.enableSharing({ topicId, visibility: 'private' });
      expect(created?.topicId).toBe(topicId);

      const updated = await caller.updateShareVisibility({ topicId, visibility: 'link' });
      expect(updated?.visibility).toBe('link');
    });

    it("another member cannot manage the creator's share", async () => {
      const creatorCaller = topicRouter.createCaller(
        createWorkspaceContext(creatorId, workspaceId),
      );
      await creatorCaller.enableSharing({ topicId, visibility: 'private' });

      const memberCaller = topicRouter.createCaller(createWorkspaceContext(memberId, workspaceId));

      await expect(
        memberCaller.updateShareVisibility({ topicId, visibility: 'link' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(memberCaller.disableSharing({ topicId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        memberCaller.enableSharing({ topicId, visibility: 'link' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it("workspace owner can manage a member's share", async () => {
      const creatorCaller = topicRouter.createCaller(
        createWorkspaceContext(creatorId, workspaceId),
      );
      await creatorCaller.enableSharing({ topicId, visibility: 'link' });

      const ownerCaller = topicRouter.createCaller(createWorkspaceContext(ownerId, workspaceId));

      const updated = await ownerCaller.updateShareVisibility({ topicId, visibility: 'private' });
      expect(updated?.visibility).toBe('private');
    });
  });

  describe('audit trail', () => {
    it('records resource.shared when visibility becomes link, and resource.unshared when it leaves', async () => {
      const caller = topicRouter.createCaller(createWorkspaceContext(creatorId, workspaceId));

      // private placeholder — no audit
      await caller.enableSharing({ topicId, visibility: 'private' });
      expect(await auditRows()).toHaveLength(0);

      // private -> link — resource.shared
      await caller.updateShareVisibility({ topicId, visibility: 'link' });
      let rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'resource.shared',
        resourceId: topicId,
        resourceType: 'topic',
        userId: creatorId,
      });

      // link -> disabled — resource.unshared
      await caller.disableSharing({ topicId });
      rows = await auditRows();
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.action).sort()).toEqual(['resource.shared', 'resource.unshared']);
    });

    it('personal mode is not audited and stays creator-managed', async () => {
      const [personalTopic] = await serverDB
        .insert(topics)
        .values({ title: 'Personal Topic', userId: creatorId })
        .returning();

      const caller = topicRouter.createCaller(createWorkspaceContext(creatorId, undefined));
      const created = await caller.enableSharing({
        topicId: personalTopic.id,
        visibility: 'link',
      });
      expect(created?.visibility).toBe('link');

      expect(await auditRows()).toHaveLength(0);
    });
  });
});
