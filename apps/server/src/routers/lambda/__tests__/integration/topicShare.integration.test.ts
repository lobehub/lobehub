// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  topics,
  workspaceAuditLogs,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  let privateTopicId: string;
  let unboundTopicId: string;

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

    await serverDB.insert(workspaceMembers).values([
      { role: 'member', userId: creatorId, workspaceId },
      { role: 'member', userId: memberId, workspaceId },
      { role: 'owner', userId: ownerId, workspaceId },
    ]);

    // Share management follows the topic's conversation, so the topics must be
    // bound to one: a shared agent (every member holds `use` by default) and a
    // private one (nobody but its creator can reach it).
    const [sharedAgent] = await serverDB
      .insert(agents)
      .values({
        slug: `share-perm-shared-${creatorId.slice(0, 8)}`,
        userId: creatorId,
        visibility: 'public',
        workspaceId,
      })
      .returning();
    const [privateAgent] = await serverDB
      .insert(agents)
      .values({
        slug: `share-perm-private-${creatorId.slice(0, 8)}`,
        userId: creatorId,
        visibility: 'private',
        workspaceId,
      })
      .returning();

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: sharedAgent.id, title: 'WS Perm Topic', userId: creatorId, workspaceId })
      .returning();
    topicId = topic.id;

    const [privateTopic] = await serverDB
      .insert(topics)
      .values({
        agentId: privateAgent.id,
        title: 'WS Private Topic',
        userId: creatorId,
        workspaceId,
      })
      .returning();
    privateTopicId = privateTopic.id;

    // Legacy shape: no agent, no group, no session — nothing for the
    // conversation guard to resolve.
    const [unboundTopic] = await serverDB
      .insert(topics)
      .values({ title: 'WS Unbound Topic', userId: creatorId, workspaceId })
      .returning();
    unboundTopicId = unboundTopic.id;
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

  describe('management permission: co-editing rule (same gate as updateTopic)', () => {
    it('creator can enable and switch their own share', async () => {
      const caller = topicRouter.createCaller(createWorkspaceContext(creatorId, workspaceId));

      const created = await caller.enableSharing({ topicId, visibility: 'private' });
      expect(created?.topicId).toBe(topicId);

      const updated = await caller.updateShareVisibility({ topicId, visibility: 'link' });
      expect(updated?.visibility).toBe('link');
    });

    it("a co-editing member can manage the creator's share", async () => {
      const creatorCaller = topicRouter.createCaller(
        createWorkspaceContext(creatorId, workspaceId),
      );
      await creatorCaller.enableSharing({ topicId, visibility: 'private' });

      const memberCaller = topicRouter.createCaller(createWorkspaceContext(memberId, workspaceId));

      // A member who may edit the conversation may share it: gating on the
      // creator instead left co-editors staring at a button that always 403'd.
      const updated = await memberCaller.updateShareVisibility({ topicId, visibility: 'link' });
      expect(updated?.visibility).toBe('link');
      await expect(memberCaller.disableSharing({ topicId })).resolves.not.toThrow();
    });

    it('a member without access to the conversation cannot manage its share', async () => {
      const creatorCaller = topicRouter.createCaller(
        createWorkspaceContext(creatorId, workspaceId),
      );
      await creatorCaller.enableSharing({ topicId: privateTopicId, visibility: 'private' });

      const memberCaller = topicRouter.createCaller(createWorkspaceContext(memberId, workspaceId));

      await expect(
        memberCaller.updateShareVisibility({ topicId: privateTopicId, visibility: 'link' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(memberCaller.disableSharing({ topicId: privateTopicId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        memberCaller.enableSharing({ topicId: privateTopicId, visibility: 'link' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('a member cannot share a topic that backs no conversation', async () => {
      // The co-editing guard resolves zero resources here, and a share link
      // reaches further than an edit — so it falls back to creator-or-owner
      // instead of letting every member publish the conversation.
      const memberCaller = topicRouter.createCaller(createWorkspaceContext(memberId, workspaceId));

      await expect(
        memberCaller.enableSharing({ topicId: unboundTopicId, visibility: 'link' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('workspace owner can still share a topic that backs no conversation', async () => {
      const ownerCaller = topicRouter.createCaller(createWorkspaceContext(ownerId, workspaceId));

      const created = await ownerCaller.enableSharing({
        topicId: unboundTopicId,
        visibility: 'private',
      });
      expect(created?.topicId).toBe(unboundTopicId);
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
