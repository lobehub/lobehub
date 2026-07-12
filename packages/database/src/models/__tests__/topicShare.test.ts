// @vitest-environment node
import { WORKSPACE_SYSTEM_ROLES } from '@lobechat/const/rbac';
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  chatGroups,
  chatGroupsAgents,
  sessions,
  topics,
  topicShares,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { seedWorkspaceRoles } from '../../utils/seedWorkspaceRoles';
import { RbacModel } from '../rbac';
import { TopicShareModel } from '../topicShare';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-share-test-user-id';
const userId2 = 'topic-share-test-user-id-2';
const sessionId = 'topic-share-test-session';
const topicId = 'topic-share-test-topic';
const topicId2 = 'topic-share-test-topic-2';
const agentId = 'topic-share-test-agent';

const topicShareModel = new TopicShareModel(serverDB, userId);
const topicShareModel2 = new TopicShareModel(serverDB, userId2);

describe('TopicShareModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);

    // Create test users, sessions, agents and topics
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }, { id: userId2 }]);
      await tx.insert(sessions).values([
        { id: sessionId, userId },
        { id: `${sessionId}-2`, userId: userId2 },
      ]);
      await tx.insert(agents).values([{ id: agentId, userId }]);
      await tx.insert(topics).values([
        { id: topicId, sessionId, userId, agentId, title: 'Test Topic' },
        { id: topicId2, sessionId, userId, title: 'Test Topic 2' },
        { id: 'user2-topic', sessionId: `${sessionId}-2`, userId: userId2, title: 'User 2 Topic' },
      ]);
    });
  });

  afterEach(async () => {
    await serverDB.delete(topicShares);
    await serverDB.delete(topics);
    await serverDB.delete(agents);
    await serverDB.delete(sessions);
    await serverDB.delete(users);
  });

  describe('create', () => {
    it('should create a share for a topic with default visibility', async () => {
      const result = await topicShareModel.create(topicId);

      expect(result).toBeDefined();
      expect(result.topicId).toBe(topicId);
      expect(result.userId).toBe(userId);
      expect(result.visibility).toBe('private');
      expect(result.id).toBeDefined();
    });

    it('should create a share with link visibility', async () => {
      const result = await topicShareModel.create(topicId, 'link');

      expect(result.visibility).toBe('link');
    });

    it('should throw error when topic does not exist', async () => {
      await expect(topicShareModel.create('non-existent-topic')).rejects.toThrow(
        'Topic not found or not owned by user',
      );
    });

    it('should throw error when trying to share another users topic', async () => {
      await expect(topicShareModel.create('user2-topic')).rejects.toThrow(
        'Topic not found or not owned by user',
      );
    });

    it('should return existing share on conflict (duplicate topic)', async () => {
      const first = await topicShareModel.create(topicId);
      const second = await topicShareModel.create(topicId);

      expect(second).toBeDefined();
      expect(second.topicId).toBe(topicId);
      expect(second.id).toBe(first.id);
    });
  });

  describe('updateVisibility', () => {
    it('should update share visibility', async () => {
      await topicShareModel.create(topicId, 'private');

      const result = await topicShareModel.updateVisibility(topicId, 'link');

      expect(result).toBeDefined();
      expect(result!.visibility).toBe('link');
    });

    it('should return null when share does not exist', async () => {
      const result = await topicShareModel.updateVisibility('non-existent-topic', 'link');

      expect(result).toBeNull();
    });

    it('should not update other users share', async () => {
      // Create share for user2
      await topicShareModel2.create('user2-topic', 'private');

      // User1 tries to update user2's share
      const result = await topicShareModel.updateVisibility('user2-topic', 'link');

      expect(result).toBeNull();

      // Verify user2's share is unchanged
      const share = await topicShareModel2.getByTopicId('user2-topic');
      expect(share!.visibility).toBe('private');
    });
  });

  describe('deleteByTopicId', () => {
    it('should delete share by topic id', async () => {
      await topicShareModel.create(topicId);

      await topicShareModel.deleteByTopicId(topicId);

      const share = await topicShareModel.getByTopicId(topicId);
      expect(share).toBeNull();
    });

    it('should not delete other users share', async () => {
      await topicShareModel2.create('user2-topic');

      // User1 tries to delete user2's share
      await topicShareModel.deleteByTopicId('user2-topic');

      // User2's share should still exist
      const share = await topicShareModel2.getByTopicId('user2-topic');
      expect(share).not.toBeNull();
    });
  });

  describe('getByTopicId', () => {
    it('should get share info by topic id', async () => {
      const created = await topicShareModel.create(topicId, 'link');

      const result = await topicShareModel.getByTopicId(topicId);

      expect(result).toBeDefined();
      expect(result!.id).toBe(created.id);
      expect(result!.topicId).toBe(topicId);
      expect(result!.visibility).toBe('link');
    });

    it('should return null when share does not exist', async () => {
      const result = await topicShareModel.getByTopicId(topicId);

      expect(result).toBeNull();
    });

    it('should not return other users share', async () => {
      await topicShareModel2.create('user2-topic');

      const result = await topicShareModel.getByTopicId('user2-topic');

      expect(result).toBeNull();
    });
  });

  describe('findByShareId (static)', () => {
    it('should find share by share id with topic and agent info', async () => {
      const created = await topicShareModel.create(topicId, 'link');

      const result = await TopicShareModel.findByShareId(serverDB, created.id);

      expect(result).toBeDefined();
      expect(result!.shareId).toBe(created.id);
      expect(result!.topicId).toBe(topicId);
      expect(result!.title).toBe('Test Topic');
      expect(result!.ownerId).toBe(userId);
      expect(result!.visibility).toBe('link');
      expect(result!.agentId).toBe(agentId);
    });

    it('should return null when share does not exist', async () => {
      const result = await TopicShareModel.findByShareId(serverDB, 'non-existent-share');

      expect(result).toBeNull();
    });

    it('should return share without agent info when topic has no agent', async () => {
      const created = await topicShareModel.create(topicId2);

      const result = await TopicShareModel.findByShareId(serverDB, created.id);

      expect(result).toBeDefined();
      expect(result!.agentId).toBeNull();
    });

    it('should return workspaceId for a workspace topic share', async () => {
      const workspaceId = 'topic-share-test-workspace';
      const wsTopicId = 'topic-share-test-ws-topic';

      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Test Workspace',
        primaryOwnerId: userId,
        slug: 'topic-share-test-ws',
      });
      await serverDB
        .insert(topics)
        .values({ id: wsTopicId, title: 'Workspace Topic', userId, workspaceId });

      const wsShareModel = new TopicShareModel(serverDB, userId, workspaceId);
      const created = await wsShareModel.create(wsTopicId, 'link');

      const result = await TopicShareModel.findByShareId(serverDB, created.id);

      expect(result).toBeDefined();
      expect(result!.workspaceId).toBe(workspaceId);
    });

    it('should return null workspaceId for a personal topic share', async () => {
      const created = await topicShareModel.create(topicId, 'link');

      const result = await TopicShareModel.findByShareId(serverDB, created.id);

      expect(result!.workspaceId).toBeNull();
    });
  });

  describe('workspace mode ownership', () => {
    const workspaceId = 'topic-share-ws-ownership';
    const wsTopicId = 'topic-share-ws-ownership-topic';
    let wsShareModel: TopicShareModel;

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Ownership WS',
        primaryOwnerId: userId,
        slug: 'topic-share-ws-ownership',
      });
      await serverDB
        .insert(topics)
        .values({ id: wsTopicId, title: 'WS Ownership Topic', userId, workspaceId });
      wsShareModel = new TopicShareModel(serverDB, userId, workspaceId);
    });

    it('getByTopicId should still find the share after switching visibility to link', async () => {
      await wsShareModel.create(wsTopicId, 'private');

      const updated = await wsShareModel.updateVisibility(wsTopicId, 'link');
      expect(updated).not.toBeNull();

      // Regression: topic_shares.visibility is 'private' | 'link' (share semantics),
      // it must NOT be treated as the workspace 'public' | 'private' row-visibility —
      // a 'link' share used to be filtered out by its own ownership clause.
      const info = await wsShareModel.getByTopicId(wsTopicId);
      expect(info).not.toBeNull();
      expect(info!.visibility).toBe('link');
    });

    it('create keeps the topic creator as share owner when another member creates the share', async () => {
      // Regression: a workspace admin creating a share for a member's topic used
      // to insert their own id as topic_shares.user_id, which downstream access
      // checks treat as ownerId — locking the actual creator out of a private share.
      const adminShareModel = new TopicShareModel(serverDB, userId2, workspaceId);

      const created = await adminShareModel.create(wsTopicId, 'private');

      expect(created!.userId).toBe(userId);
    });

    it('updateVisibility can switch a link share back to private', async () => {
      await wsShareModel.create(wsTopicId, 'link');

      const updated = await wsShareModel.updateVisibility(wsTopicId, 'private');
      expect(updated).not.toBeNull();
      expect(updated!.visibility).toBe('private');
    });

    it('deleteByTopicId removes a link share in workspace mode', async () => {
      const created = await wsShareModel.create(wsTopicId, 'link');

      await wsShareModel.deleteByTopicId(wsTopicId);

      const result = await TopicShareModel.findByShareId(serverDB, created.id);
      expect(result).toBeNull();
    });

    describe('findByShareIdWithAccessCheck — private is creator-only, even in a workspace', () => {
      beforeEach(async () => {
        await seedWorkspaceRoles(serverDB, workspaceId);
      });

      it('rejects a workspace member (viewer role) for a private share', async () => {
        await new RbacModel(serverDB, userId2).assignWorkspaceRole({
          roleName: WORKSPACE_SYSTEM_ROLES.VIEWER,
          userId: userId2,
          workspaceId,
        });
        const created = await wsShareModel.create(wsTopicId, 'private');

        try {
          await TopicShareModel.findByShareIdWithAccessCheck(serverDB, created.id, userId2);
          throw new Error('should not reach');
        } catch (error) {
          expect((error as TRPCError).code).toBe('FORBIDDEN');
        }
      });

      it('allows the creator to view their own private share', async () => {
        const created = await wsShareModel.create(wsTopicId, 'private');

        const result = await TopicShareModel.findByShareIdWithAccessCheck(
          serverDB,
          created.id,
          userId,
        );

        expect(result.topicId).toBe(wsTopicId);
      });

      it('rejects a non-member user for a private workspace share', async () => {
        const created = await wsShareModel.create(wsTopicId, 'private');

        try {
          await TopicShareModel.findByShareIdWithAccessCheck(serverDB, created.id, userId2);
          throw new Error('should not reach');
        } catch (error) {
          expect((error as TRPCError).code).toBe('FORBIDDEN');
        }
      });

      it('rejects anonymous access for a private workspace share', async () => {
        const created = await wsShareModel.create(wsTopicId, 'private');

        try {
          await TopicShareModel.findByShareIdWithAccessCheck(serverDB, created.id, undefined);
          throw new Error('should not reach');
        } catch (error) {
          expect((error as TRPCError).code).toBe('FORBIDDEN');
        }
      });

      it('still allows anonymous access for a link workspace share', async () => {
        const created = await wsShareModel.create(wsTopicId, 'link');

        const result = await TopicShareModel.findByShareIdWithAccessCheck(
          serverDB,
          created.id,
          undefined,
        );

        expect(result.topicId).toBe(wsTopicId);
      });
    });
  });

  describe('incrementPageViewCount (static)', () => {
    it('should increment page view count', async () => {
      const created = await topicShareModel.create(topicId);

      // Initial page view count is 0
      const initial = await serverDB.query.topicShares.findFirst({
        where: (t, { eq }) => eq(t.id, created.id),
      });
      expect(initial!.pageViewCount).toBe(0);

      // Increment page view count
      await TopicShareModel.incrementPageViewCount(serverDB, created.id);

      const after = await serverDB.query.topicShares.findFirst({
        where: (t, { eq }) => eq(t.id, created.id),
      });
      expect(after!.pageViewCount).toBe(1);
    });

    it('should increment page view count multiple times', async () => {
      const created = await topicShareModel.create(topicId);

      await TopicShareModel.incrementPageViewCount(serverDB, created.id);
      await TopicShareModel.incrementPageViewCount(serverDB, created.id);
      await TopicShareModel.incrementPageViewCount(serverDB, created.id);

      const result = await serverDB.query.topicShares.findFirst({
        where: (t, { eq }) => eq(t.id, created.id),
      });
      expect(result!.pageViewCount).toBe(3);
    });
  });

  describe('findByShareIdWithAccessCheck (static)', () => {
    it('should return share for owner regardless of visibility', async () => {
      const created = await topicShareModel.create(topicId, 'private');

      const result = await TopicShareModel.findByShareIdWithAccessCheck(
        serverDB,
        created.id,
        userId,
      );

      expect(result).toBeDefined();
      expect(result.shareId).toBe(created.id);
    });

    it('should return share for anonymous user when visibility is link', async () => {
      const created = await topicShareModel.create(topicId, 'link');

      const result = await TopicShareModel.findByShareIdWithAccessCheck(
        serverDB,
        created.id,
        undefined,
      );

      expect(result).toBeDefined();
      expect(result.shareId).toBe(created.id);
    });

    it('should throw NOT_FOUND when share does not exist', async () => {
      await expect(
        TopicShareModel.findByShareIdWithAccessCheck(serverDB, 'non-existent', userId),
      ).rejects.toThrow(TRPCError);

      try {
        await TopicShareModel.findByShareIdWithAccessCheck(serverDB, 'non-existent', userId);
      } catch (error) {
        expect((error as TRPCError).code).toBe('NOT_FOUND');
      }
    });

    it('should throw FORBIDDEN when visibility is private and user is not owner', async () => {
      const created = await topicShareModel.create(topicId, 'private');

      await expect(
        TopicShareModel.findByShareIdWithAccessCheck(serverDB, created.id, userId2),
      ).rejects.toThrow(TRPCError);

      try {
        await TopicShareModel.findByShareIdWithAccessCheck(serverDB, created.id, userId2);
      } catch (error) {
        expect((error as TRPCError).code).toBe('FORBIDDEN');
      }
    });

    it('should throw FORBIDDEN when visibility is private and user is anonymous', async () => {
      const created = await topicShareModel.create(topicId, 'private');

      await expect(
        TopicShareModel.findByShareIdWithAccessCheck(serverDB, created.id, undefined),
      ).rejects.toThrow(TRPCError);

      try {
        await TopicShareModel.findByShareIdWithAccessCheck(serverDB, created.id, undefined);
      } catch (error) {
        expect((error as TRPCError).code).toBe('FORBIDDEN');
      }
    });
  });

  describe('user isolation', () => {
    it('should enforce user data isolation for all operations', async () => {
      // User1 creates a share
      await topicShareModel.create(topicId, 'private');

      // User2 creates a share
      await topicShareModel2.create('user2-topic', 'link');

      // User1 cannot access user2's share via getByTopicId
      const user1Access = await topicShareModel.getByTopicId('user2-topic');
      expect(user1Access).toBeNull();

      // User2 cannot access user1's share via getByTopicId
      const user2Access = await topicShareModel2.getByTopicId(topicId);
      expect(user2Access).toBeNull();

      // User1 cannot update user2's share
      const updateResult = await topicShareModel.updateVisibility('user2-topic', 'private');
      expect(updateResult).toBeNull();

      // User1 cannot delete user2's share
      await topicShareModel.deleteByTopicId('user2-topic');
      const stillExists = await topicShareModel2.getByTopicId('user2-topic');
      expect(stillExists).not.toBeNull();
    });
  });

  describe('findByShareId with group topic', () => {
    it('should return group members for a group topic share', async () => {
      // Create a chat group with agents
      const [group] = await serverDB
        .insert(chatGroups)
        .values({ userId, title: 'Test Group' })
        .returning();

      const agent2Id = 'group-member-agent';
      await serverDB.insert(agents).values({ id: agent2Id, userId, title: 'Group Agent' });
      await serverDB
        .insert(chatGroupsAgents)
        .values({ chatGroupId: group.id, agentId: agent2Id, userId, order: 0 });

      // Create a topic with groupId
      const groupTopicId = 'group-topic-id';
      await serverDB.insert(topics).values({
        id: groupTopicId,
        sessionId,
        userId,
        title: 'Group Topic',
        groupId: group.id,
      });

      // Create a share
      const share = await topicShareModel.create(groupTopicId);

      // Find by share ID
      const result = await TopicShareModel.findByShareId(serverDB, share.id);
      expect(result).toBeDefined();
      expect(result?.groupId).toBe(group.id);
      expect(result?.groupMembers).toBeDefined();
      expect(result?.groupMembers).toHaveLength(1);
      expect(result?.groupMembers?.[0].id).toBe(agent2Id);
    });
  });
});
