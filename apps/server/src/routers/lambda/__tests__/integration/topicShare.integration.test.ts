// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  chatGroups,
  chatGroupsAgents,
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

  describe('agent topic-share policy', () => {
    /** A workspace agent plus one topic the given member owns under it. */
    const seedAgentTopic = async (params: {
      agentUserId: string;
      topicSharePolicy?: 'member' | 'restricted';
      topicUserId: string;
    }) => {
      const [agent] = await serverDB
        .insert(agents)
        .values({
          agencyConfig: params.topicSharePolicy
            ? { topicSharePolicy: params.topicSharePolicy }
            : null,
          title: 'Policy Agent',
          userId: params.agentUserId,
          visibility: 'public',
          workspaceId,
        })
        .returning();

      const [topic] = await serverDB
        .insert(topics)
        .values({
          agentId: agent.id,
          title: 'Policy Topic',
          userId: params.topicUserId,
          workspaceId,
        })
        .returning();

      return { agentId: agent.id, topicId: topic.id };
    };

    /**
     * A group whose supervisor holds the policy, plus a topic that carries only
     * `groupId` — the shape `createTopic({ groupId })` produces when no agent or
     * session is supplied.
     */
    const seedGroupTopic = async (params: {
      supervisorUserId: string;
      topicSharePolicy?: 'member' | 'restricted';
      topicUserId: string;
    }) => {
      const [supervisor] = await serverDB
        .insert(agents)
        .values({
          agencyConfig: params.topicSharePolicy
            ? { topicSharePolicy: params.topicSharePolicy }
            : null,
          title: 'Supervisor',
          userId: params.supervisorUserId,
          virtual: true,
          visibility: 'public',
          workspaceId,
        })
        .returning();

      const [group] = await serverDB
        .insert(chatGroups)
        .values({
          title: 'Policy Group',
          userId: params.supervisorUserId,
          visibility: 'public',
          workspaceId,
        })
        .returning();

      await serverDB.insert(chatGroupsAgents).values({
        agentId: supervisor.id,
        chatGroupId: group.id,
        order: -1,
        role: 'supervisor',
        userId: params.supervisorUserId,
        workspaceId,
      });

      const [topic] = await serverDB
        .insert(topics)
        .values({
          groupId: group.id,
          title: 'Group Policy Topic',
          userId: params.topicUserId,
          workspaceId,
        })
        .returning();

      return { groupId: group.id, supervisorAgentId: supervisor.id, topicId: topic.id };
    };

    it("blocks publishing a group topic through the supervisor's policy", async () => {
      // `createTopic({ groupId })` stores neither an agent nor a session, so
      // reading `agentId` first would leave these rows with no policy at all —
      // and the group Permission page writes the policy onto this supervisor.
      const seeded = await seedGroupTopic({
        supervisorUserId: creatorId,
        topicSharePolicy: 'restricted',
        topicUserId: memberId,
      });

      const memberCaller = topicRouter.createCaller(createWorkspaceContext(memberId, workspaceId));

      await expect(
        memberCaller.enableSharing({ topicId: seeded.topicId, visibility: 'link' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // The placeholder still works, same as the agent case.
      await expect(
        memberCaller.enableSharing({ topicId: seeded.topicId, visibility: 'private' }),
      ).resolves.toMatchObject({ visibility: 'private' });
    });

    it('leaves group topics publishable under the default supervisor policy', async () => {
      const seeded = await seedGroupTopic({ supervisorUserId: creatorId, topicUserId: memberId });

      const memberCaller = topicRouter.createCaller(createWorkspaceContext(memberId, workspaceId));

      await expect(
        memberCaller.enableSharing({ topicId: seeded.topicId, visibility: 'link' }),
      ).resolves.toMatchObject({ visibility: 'link' });
    });

    it('blocks a member from publishing a link under a restricted agent', async () => {
      const seeded = await seedAgentTopic({
        agentUserId: creatorId,
        topicSharePolicy: 'restricted',
        topicUserId: memberId,
      });

      const memberCaller = topicRouter.createCaller(createWorkspaceContext(memberId, workspaceId));

      await expect(
        memberCaller.enableSharing({ topicId: seeded.topicId, visibility: 'link' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('still lets a restricted member create the private placeholder and revoke', async () => {
      const seeded = await seedAgentTopic({
        agentUserId: creatorId,
        topicSharePolicy: 'restricted',
        topicUserId: memberId,
      });

      const memberCaller = topicRouter.createCaller(createWorkspaceContext(memberId, workspaceId));

      // The share popover opens by creating this placeholder — gating it would
      // leave a restricted member unable to load the panel at all.
      const created = await memberCaller.enableSharing({
        topicId: seeded.topicId,
        visibility: 'private',
      });
      expect(created?.visibility).toBe('private');

      // Pulling a topic out of circulation is always safe.
      const revoked = await memberCaller.updateShareVisibility({
        topicId: seeded.topicId,
        visibility: 'private',
      });
      expect(revoked?.visibility).toBe('private');
      await expect(memberCaller.disableSharing({ topicId: seeded.topicId })).resolves.toBeDefined();
    });

    it('lets the agent creator and the workspace owner publish under a restricted agent', async () => {
      const creatorOwned = await seedAgentTopic({
        agentUserId: creatorId,
        topicSharePolicy: 'restricted',
        topicUserId: creatorId,
      });
      const creatorCaller = topicRouter.createCaller(
        createWorkspaceContext(creatorId, workspaceId),
      );
      const published = await creatorCaller.enableSharing({
        topicId: creatorOwned.topicId,
        visibility: 'link',
      });
      expect(published?.visibility).toBe('link');

      const memberOwned = await seedAgentTopic({
        agentUserId: creatorId,
        topicSharePolicy: 'restricted',
        topicUserId: memberId,
      });
      const ownerCaller = topicRouter.createCaller(createWorkspaceContext(ownerId, workspaceId));
      const ownerPublished = await ownerCaller.enableSharing({
        topicId: memberOwned.topicId,
        visibility: 'link',
      });
      expect(ownerPublished?.visibility).toBe('link');
    });

    it("lets a member publish another member's topic under the member policy", async () => {
      // The permission is about the AGENT's topics, not just one's own: under
      // `member` a member may publish a topic someone else created.
      const ownerOwned = await seedAgentTopic({
        agentUserId: creatorId,
        topicSharePolicy: 'member',
        topicUserId: creatorId,
      });

      const memberCaller = topicRouter.createCaller(createWorkspaceContext(memberId, workspaceId));

      await expect(
        memberCaller.enableSharing({ topicId: ownerOwned.topicId, visibility: 'link' }),
      ).resolves.toMatchObject({ visibility: 'link' });
      // ...and take it back out of circulation.
      await expect(
        memberCaller.updateShareVisibility({ topicId: ownerOwned.topicId, visibility: 'private' }),
      ).resolves.toMatchObject({ visibility: 'private' });
    });

    it("keeps another member's topic off-limits when the topic has no agent", async () => {
      // Legacy rule survives for agent-less rows: the member policy is granted
      // BY an agent, so a topic that answers to none keeps creator+owner only.
      const creatorCaller = topicRouter.createCaller(
        createWorkspaceContext(creatorId, workspaceId),
      );
      await creatorCaller.enableSharing({ topicId: unboundTopicId, visibility: 'private' });

      const memberCaller = topicRouter.createCaller(createWorkspaceContext(memberId, workspaceId));
      await expect(
        memberCaller.updateShareVisibility({ topicId: unboundTopicId, visibility: 'link' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('leaves members publishing under the default and legacy policies', async () => {
      const explicitMember = await seedAgentTopic({
        agentUserId: creatorId,
        topicSharePolicy: 'member',
        topicUserId: memberId,
      });
      // Legacy rows predate the field entirely and must keep working.
      const legacy = await seedAgentTopic({ agentUserId: creatorId, topicUserId: memberId });

      const memberCaller = topicRouter.createCaller(createWorkspaceContext(memberId, workspaceId));

      await expect(
        memberCaller.enableSharing({ topicId: explicitMember.topicId, visibility: 'link' }),
      ).resolves.toMatchObject({ visibility: 'link' });
      await expect(
        memberCaller.enableSharing({ topicId: legacy.topicId, visibility: 'link' }),
      ).resolves.toMatchObject({ visibility: 'link' });
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
