// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { sessions, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topicRouter } from '../../topic';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

// We need to mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Mock next/server's after() to execute callback immediately in tests
vi.mock('next/server', () => ({
  after: vi.fn((callback: () => void) => callback()),
}));

/**
 * Topic Router 集成测试
 *
 * 测试目标：
 * 1. 验证完整的 tRPC 调用链路（Router → Model → Database）
 * 2. 确保 agentId → sessionId 解析正常工作
 * 3. 验证数据库约束和关联关系
 */
describe('Topic Router Integration Tests', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let testSessionId: string;
  let testAgentId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);

    // 创建测试 agent
    const { agents } = await import('@/database/schemas');
    const [agent] = await serverDB
      .insert(agents)
      .values({ userId, title: 'Test Agent' })
      .returning();
    testAgentId = agent.id;

    // 创建测试 session
    const [session] = await serverDB.insert(sessions).values({ userId, type: 'agent' }).returning();
    testSessionId = session.id;

    // 创建 agent 到 session 的映射关系
    const { agentsToSessions } = await import('@/database/schemas');
    await serverDB.insert(agentsToSessions).values({
      agentId: testAgentId,
      sessionId: testSessionId,
      userId,
    });
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  describe('createTopic', () => {
    it('should create topic with sessionId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      const topicId = await caller.createTopic({
        title: 'Test Topic',
        sessionId: testSessionId,
      });

      const [createdTopic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));

      expect(createdTopic).toBeDefined();
      expect(createdTopic.title).toBe('Test Topic');
      expect(createdTopic.sessionId).toBe(testSessionId);
    });

    it('should create topic using agentId instead of sessionId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      const topicId = await caller.createTopic({
        title: 'Topic with agentId',
        agentId: testAgentId,
      });

      const [createdTopic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));

      expect(createdTopic).toBeDefined();
      expect(createdTopic.title).toBe('Topic with agentId');
      // 验证 agentId 被正确解析为 sessionId
      expect(createdTopic.sessionId).toBe(testSessionId);
    });

    it('should prefer agentId over sessionId when both provided', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // 创建另一个 session
      const [anotherSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
          type: 'agent',
        })
        .returning();

      const topicId = await caller.createTopic({
        title: 'Topic with both ids',
        agentId: testAgentId,
        sessionId: anotherSession.id, // 这个会被 agentId 覆盖
      });

      const [createdTopic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));

      // 应该使用 agentId 解析出的 sessionId
      expect(createdTopic.sessionId).toBe(testSessionId);
    });

    it('should fall back to sessionId when agentId not found', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      const topicId = await caller.createTopic({
        title: 'Topic with non-existent agentId',
        agentId: 'non-existent-agent',
        sessionId: testSessionId,
      });

      const [createdTopic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));

      expect(createdTopic.sessionId).toBe(testSessionId);
    });
  });

  describe('batchCreateTopics', () => {
    it('should batch create topics with agentId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      const result = await caller.batchCreateTopics([
        { title: 'Batch Topic 1', agentId: testAgentId },
        { title: 'Batch Topic 2', agentId: testAgentId },
      ]);

      expect(result.success).toBe(true);
      expect(result.added).toBe(2);

      const createdTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.sessionId, testSessionId));

      expect(createdTopics).toHaveLength(2);
      expect(createdTopics.map((t) => t.title)).toContain('Batch Topic 1');
      expect(createdTopics.map((t) => t.title)).toContain('Batch Topic 2');
    });

    it('should batch create topics with mixed agentId and sessionId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // 创建另一个 session
      const [anotherSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
          type: 'agent',
        })
        .returning();

      const result = await caller.batchCreateTopics([
        { title: 'Topic with agentId', agentId: testAgentId },
        { title: 'Topic with sessionId', sessionId: anotherSession.id },
      ]);

      expect(result.success).toBe(true);
      expect(result.added).toBe(2);

      // 验证每个 topic 关联到正确的 session
      const allTopics = await serverDB.select().from(topics).where(eq(topics.userId, userId));

      const topicWithAgent = allTopics.find((t) => t.title === 'Topic with agentId');
      const topicWithSession = allTopics.find((t) => t.title === 'Topic with sessionId');

      expect(topicWithAgent?.sessionId).toBe(testSessionId);
      expect(topicWithSession?.sessionId).toBe(anotherSession.id);
    });
  });

  describe('getTopics', () => {
    it('should get topics by agentId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // 创建测试 topic
      await caller.createTopic({
        title: 'Topic 1',
        sessionId: testSessionId,
      });

      await caller.createTopic({
        title: 'Topic 2',
        sessionId: testSessionId,
      });

      // 使用 agentId 查询
      const result = await caller.getTopics({
        agentId: testAgentId,
      });

      // result 包含 items 和 total
      expect(result.items).toHaveLength(2);
      expect(result.items.map((t) => t.title)).toContain('Topic 1');
      expect(result.items.map((t) => t.title)).toContain('Topic 2');
      expect(result.total).toBe(2);
    });

    it('should resolve sessionId to agentId when only sessionId provided', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // 创建测试 topic
      await caller.createTopic({
        title: 'Topic for reverse lookup',
        sessionId: testSessionId,
      });

      // 使用 sessionId 查询（需要反向查找 agentId）
      const result = await caller.getTopics({
        sessionId: testSessionId,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Topic for reverse lookup');
      expect(result.total).toBe(1);
    });
  });

  describe('batchDeleteBySessionId', () => {
    it('should batch delete topics using agentId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // 创建测试 topics
      await caller.createTopic({
        title: 'Topic to delete 1',
        sessionId: testSessionId,
      });

      await caller.createTopic({
        title: 'Topic to delete 2',
        sessionId: testSessionId,
      });

      // 使用 agentId 批量删除
      await caller.batchDeleteBySessionId({
        agentId: testAgentId,
      });

      const remainingTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.sessionId, testSessionId));

      expect(remainingTopics).toHaveLength(0);
    });

    it('should batch delete topics using sessionId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // 创建测试 topics
      await caller.createTopic({
        title: 'Topic to delete',
        sessionId: testSessionId,
      });

      // 使用 sessionId 批量删除
      await caller.batchDeleteBySessionId({
        id: testSessionId,
      });

      const remainingTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.sessionId, testSessionId));

      expect(remainingTopics).toHaveLength(0);
    });
  });

  describe('batchDeleteByAgentId', () => {
    it('should batch delete topics by agentId (new data)', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Create topics with agentId directly (new data structure)
      const topicId1 = await caller.createTopic({
        title: 'Agent Topic 1',
        agentId: testAgentId,
      });
      const topicId2 = await caller.createTopic({
        title: 'Agent Topic 2',
        agentId: testAgentId,
      });

      // Batch delete by agentId
      await caller.batchDeleteByAgentId({
        agentId: testAgentId,
      });

      const remainingTopics = await serverDB.select().from(topics).where(eq(topics.userId, userId));

      expect(remainingTopics).toHaveLength(0);
    });

    it('should batch delete topics by agentId (legacy sessionId data)', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Create topics with sessionId (legacy data structure)
      await caller.createTopic({
        title: 'Legacy Topic 1',
        sessionId: testSessionId,
      });
      await caller.createTopic({
        title: 'Legacy Topic 2',
        sessionId: testSessionId,
      });

      // Batch delete by agentId should also delete legacy topics via sessionId mapping
      await caller.batchDeleteByAgentId({
        agentId: testAgentId,
      });

      const remainingTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.sessionId, testSessionId));

      expect(remainingTopics).toHaveLength(0);
    });

    it('should batch delete topics by agentId (mixed data)', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Create both new (agentId) and legacy (sessionId) topics
      await caller.createTopic({
        title: 'New Agent Topic',
        agentId: testAgentId,
      });
      await caller.createTopic({
        title: 'Legacy Session Topic',
        sessionId: testSessionId,
      });

      // Batch delete by agentId should delete both
      await caller.batchDeleteByAgentId({
        agentId: testAgentId,
      });

      const remainingTopics = await serverDB.select().from(topics).where(eq(topics.userId, userId));

      expect(remainingTopics).toHaveLength(0);
    });
  });

  describe('searchTopics', () => {
    it('should search topics using agentId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // 创建测试 topics
      await caller.createTopic({
        title: 'TypeScript Discussion',
        sessionId: testSessionId,
      });

      await caller.createTopic({
        title: 'JavaScript Basics',
        sessionId: testSessionId,
      });

      // 使用 agentId 搜索
      const result = await caller.searchTopics({
        keywords: 'TypeScript',
        agentId: testAgentId,
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toContain('TypeScript');
    });
  });

  describe('updateTopic', () => {
    it('should update topic with agentId in value', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // 创建测试 topic
      const topicId = await caller.createTopic({
        title: 'Original Title',
        sessionId: testSessionId,
      });

      // 创建另一个 agent 和 session
      const { agents, agentsToSessions } = await import('@/database/schemas');
      const [newAgent] = await serverDB
        .insert(agents)
        .values({
          userId,
          title: 'New Agent',
        })
        .returning();

      const [newSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
          type: 'agent',
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: newAgent.id,
        sessionId: newSession.id,
        userId,
      });

      // 更新 topic，使用 agentId 指定新的关联
      await caller.updateTopic({
        id: topicId,
        value: {
          title: 'Updated Title',
          agentId: newAgent.id,
        },
      });

      const [updatedTopic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));

      expect(updatedTopic.title).toBe('Updated Title');
      expect(updatedTopic.sessionId).toBe(newSession.id);
    });
  });

  describe('runtime migration - agentId backfill', () => {
    it('should trigger migration for legacy topics (with sessionId but no agentId)', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Directly insert legacy topic with sessionId but no agentId (simulating old data)
      const [legacyTopic] = await serverDB
        .insert(topics)
        .values({
          title: 'Legacy Topic',
          sessionId: testSessionId,
          agentId: null, // Legacy data has no agentId
          userId,
        })
        .returning();

      // Verify the topic has no agentId initially
      const [beforeMigration] = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, legacyTopic.id));
      expect(beforeMigration.agentId).toBeNull();

      // Query topics using agentId - this should trigger migration
      const result = await caller.getTopics({
        agentId: testAgentId,
      });

      // Should return the legacy topic
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(legacyTopic.id);

      // Wait a bit for the after() callback to execute
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the agentId was backfilled
      const [afterMigration] = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, legacyTopic.id));
      expect(afterMigration.agentId).toBe(testAgentId);
    });

    it('should not migrate topics that already have agentId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Create topic with agentId already set
      const [topicWithAgentId] = await serverDB
        .insert(topics)
        .values({
          title: 'New Topic',
          sessionId: testSessionId,
          agentId: testAgentId, // Already has agentId
          userId,
        })
        .returning();

      // Query topics using agentId
      await caller.getTopics({
        agentId: testAgentId,
      });

      // Wait for potential migration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the agentId is unchanged
      const [afterQuery] = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, topicWithAgentId.id));
      expect(afterQuery.agentId).toBe(testAgentId);
    });

    it('should migrate multiple legacy topics in batch', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Insert multiple legacy topics
      const legacyTopics = await serverDB
        .insert(topics)
        .values([
          { title: 'Legacy 1', sessionId: testSessionId, agentId: null, userId },
          { title: 'Legacy 2', sessionId: testSessionId, agentId: null, userId },
          { title: 'Legacy 3', sessionId: testSessionId, agentId: null, userId },
        ])
        .returning();

      // Query topics using agentId
      const result = await caller.getTopics({
        agentId: testAgentId,
      });

      expect(result.items).toHaveLength(3);

      // Wait for migration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify all topics were migrated
      for (const topic of legacyTopics) {
        const [migrated] = await serverDB.select().from(topics).where(eq(topics.id, topic.id));
        expect(migrated.agentId).toBe(testAgentId);
      }
    });

    it('should only migrate topics that match the query', async () => {
      // Create another agent and session
      const { agents, agentsToSessions } = await import('@/database/schemas');
      const [otherAgent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Other Agent' })
        .returning();

      const [otherSession] = await serverDB
        .insert(sessions)
        .values({ userId, type: 'agent' })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: otherAgent.id,
        sessionId: otherSession.id,
        userId,
      });

      // Insert legacy topics for different sessions
      const [topic1] = await serverDB
        .insert(topics)
        .values({ title: 'Topic 1', sessionId: testSessionId, agentId: null, userId })
        .returning();

      const [topic2] = await serverDB
        .insert(topics)
        .values({ title: 'Topic 2', sessionId: otherSession.id, agentId: null, userId })
        .returning();

      const caller = topicRouter.createCaller(createTestContext(userId));

      // Query only for testAgentId
      await caller.getTopics({ agentId: testAgentId });

      // Wait for migration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Only topic1 should be migrated
      const [migrated1] = await serverDB.select().from(topics).where(eq(topics.id, topic1.id));
      const [migrated2] = await serverDB.select().from(topics).where(eq(topics.id, topic2.id));

      expect(migrated1.agentId).toBe(testAgentId);
      expect(migrated2.agentId).toBeNull(); // Should not be migrated
    });
  });

  describe('inbox agent queries', () => {
    let inboxAgentId: string;

    beforeEach(async () => {
      // Create an inbox agent (virtual agent with slug='inbox')
      const { agents } = await import('@/database/schemas');
      const [inboxAgent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Inbox Agent', slug: 'inbox', virtual: true })
        .returning();
      inboxAgentId = inboxAgent.id;
    });

    it('should query legacy inbox topics with isInbox=true', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Insert legacy inbox topic (sessionId IS NULL, groupId IS NULL, agentId IS NULL)
      await serverDB.insert(topics).values({
        title: 'Legacy Inbox Topic',
        sessionId: null,
        groupId: null,
        agentId: null,
        userId,
      });

      // Query with isInbox=true
      const result = await caller.getTopics({
        agentId: inboxAgentId,
        isInbox: true,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Legacy Inbox Topic');
    });

    it('should query both legacy inbox topics and new inbox topics', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Insert legacy inbox topic
      await serverDB.insert(topics).values({
        title: 'Legacy Inbox Topic',
        sessionId: null,
        groupId: null,
        agentId: null,
        userId,
      });

      // Insert new inbox topic with agentId
      await serverDB.insert(topics).values({
        title: 'New Inbox Topic',
        sessionId: null,
        groupId: null,
        agentId: inboxAgentId,
        userId,
      });

      // Query with isInbox=true
      const result = await caller.getTopics({
        agentId: inboxAgentId,
        isInbox: true,
      });

      expect(result.items).toHaveLength(2);
      expect(result.items.map((t) => t.title)).toContain('Legacy Inbox Topic');
      expect(result.items.map((t) => t.title)).toContain('New Inbox Topic');
    });

    it('should migrate legacy inbox topics when queried', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Insert legacy inbox topic
      const [legacyTopic] = await serverDB
        .insert(topics)
        .values({
          title: 'Legacy Inbox to Migrate',
          sessionId: null,
          groupId: null,
          agentId: null,
          userId,
        })
        .returning();

      // Query with isInbox=true
      await caller.getTopics({
        agentId: inboxAgentId,
        isInbox: true,
      });

      // Wait for migration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify agentId was backfilled
      const [migrated] = await serverDB.select().from(topics).where(eq(topics.id, legacyTopic.id));
      expect(migrated.agentId).toBe(inboxAgentId);
    });

    it('should not include legacy inbox topics when isInbox=false', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Insert legacy inbox topic
      await serverDB.insert(topics).values({
        title: 'Legacy Inbox Topic',
        sessionId: null,
        groupId: null,
        agentId: null,
        userId,
      });

      // Query without isInbox (default is false/undefined)
      // Using testAgentId instead since it has a proper session mapping
      const result = await caller.getTopics({
        agentId: testAgentId,
      });

      // Legacy inbox topic should NOT be included
      expect(result.items.some((t) => t.title === 'Legacy Inbox Topic')).toBe(false);
    });

    it('should not return sessionId/agentId in items for inbox queries', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Insert inbox topic with agentId
      await serverDB.insert(topics).values({
        title: 'Inbox Topic',
        sessionId: null,
        groupId: null,
        agentId: inboxAgentId,
        userId,
      });

      // Query with isInbox=true
      const result = await caller.getTopics({
        agentId: inboxAgentId,
        isInbox: true,
      });

      expect(result.items).toHaveLength(1);
      // Verify internal fields are not exposed
      expect('sessionId' in result.items[0]).toBe(false);
      expect('agentId' in result.items[0]).toBe(false);
    });
  });

  describe('other topic operations', () => {
    it('should clone topic', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // 创建原始 topic
      const originalId = await caller.createTopic({
        title: 'Original Topic',
        sessionId: testSessionId,
      });

      // 克隆 topic
      const clonedId = await caller.cloneTopic({
        id: originalId,
        newTitle: 'Cloned Topic',
      });

      const [clonedTopic] = await serverDB.select().from(topics).where(eq(topics.id, clonedId));

      expect(clonedTopic).toBeDefined();
      expect(clonedTopic.title).toBe('Cloned Topic');
      expect(clonedTopic.sessionId).toBe(testSessionId);
    });

    it('should batch delete topics by ids', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      const id1 = await caller.createTopic({
        title: 'Topic 1',
        sessionId: testSessionId,
      });

      const id2 = await caller.createTopic({
        title: 'Topic 2',
        sessionId: testSessionId,
      });

      await caller.createTopic({
        title: 'Topic 3',
        sessionId: testSessionId,
      });

      // 删除前两个
      await caller.batchDelete({ ids: [id1, id2] });

      const remainingTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.sessionId, testSessionId));

      expect(remainingTopics).toHaveLength(1);
      expect(remainingTopics[0].title).toBe('Topic 3');
    });

    it('should remove single topic', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      const topicId = await caller.createTopic({
        title: 'Topic to remove',
        sessionId: testSessionId,
      });

      await caller.removeTopic({ id: topicId });

      const deletedTopic = await serverDB.select().from(topics).where(eq(topics.id, topicId));

      expect(deletedTopic).toHaveLength(0);
    });

    it('should count topics', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      await caller.createTopic({
        title: 'Topic 1',
        sessionId: testSessionId,
      });

      await caller.createTopic({
        title: 'Topic 2',
        sessionId: testSessionId,
      });

      const count = await caller.countTopics();

      expect(count).toBe(2);
    });

    it('should get all topics', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      await caller.createTopic({
        title: 'Topic 1',
        sessionId: testSessionId,
      });

      await caller.createTopic({
        title: 'Topic 2',
        sessionId: testSessionId,
      });

      const allTopics = await caller.getAllTopics();

      expect(allTopics).toHaveLength(2);
    });

    it('should check if user has topics', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // 初始应该没有 topics
      const hasNoTopics = await caller.hasTopics();
      expect(hasNoTopics).toBe(true); // 注意：hasTopics 返回 count === 0

      // 创建 topic 后
      await caller.createTopic({
        title: 'First Topic',
        sessionId: testSessionId,
      });

      const hasTopicsAfter = await caller.hasTopics();
      expect(hasTopicsAfter).toBe(false); // count !== 0
    });
  });
});
