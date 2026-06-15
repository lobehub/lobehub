// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { sessions, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topicRouter } from '../../topic';
import { cleanupTestUser, createTestAgent, createTestContext, createTestUser } from './setup';

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
 * Topic Router Integration Tests
 *
 * Test objectives:
 * 1. Verify the complete tRPC call chain (Router → Model → Database)
 * 2. Ensure agentId → sessionId resolution works correctly
 * 3. Verify database constraints and associations
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

    // Create test agent
    const { agents } = await import('@/database/schemas');
    const [agent] = await serverDB
      .insert(agents)
      .values({ userId, title: 'Test Agent' })
      .returning();
    testAgentId = agent.id;

    // Create test session
    const [session] = await serverDB.insert(sessions).values({ userId, type: 'agent' }).returning();
    testSessionId = session.id;

    // Create agent-to-session mapping
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
      // Verify agentId is correctly resolved to sessionId
      expect(createdTopic.sessionId).toBe(testSessionId);
    });

    it('should prefer agentId over sessionId when both provided', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Create another session
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
        sessionId: anotherSession.id, // This will be overridden by agentId
      });

      const [createdTopic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));

      // Should use the sessionId resolved from agentId
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

      // Create another session
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

      // Verify each topic is linked to the correct session
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

      // Topics are agent-native: stored with agentId directly
      await serverDB.insert(topics).values([
        { title: 'Topic 1', agentId: testAgentId, userId },
        { title: 'Topic 2', agentId: testAgentId, userId },
      ]);

      // Query using agentId
      const result = await caller.getTopics({
        agentId: testAgentId,
      });

      // result contains items and total
      expect(result.items).toHaveLength(2);
      expect(result.items.map((t) => t.title)).toContain('Topic 1');
      expect(result.items.map((t) => t.title)).toContain('Topic 2');
      expect(result.total).toBe(2);
    });

    it('should resolve sessionId to agentId when only sessionId provided', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Agent-native topic; queried via sessionId, which the procedure
      // reverse-resolves to agentId before matching `topics.agentId`.
      await serverDB.insert(topics).values({
        title: 'Topic for reverse lookup',
        agentId: testAgentId,
        userId,
      });

      // Query using sessionId (requires reverse lookup of agentId)
      const result = await caller.getTopics({
        sessionId: testSessionId,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Topic for reverse lookup');
      expect(result.total).toBe(1);
    });

    it('should prioritize includeTriggers over excludeTriggers', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      await serverDB.insert(topics).values([
        {
          title: 'Cron Topic',
          agentId: testAgentId,
          trigger: 'cron',
          userId,
        },
        {
          title: 'Eval Topic',
          agentId: testAgentId,
          trigger: 'eval',
          userId,
        },
      ]);

      const result = await caller.getTopics({
        agentId: testAgentId,
        excludeTriggers: ['cron'],
        includeTriggers: ['cron'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Cron Topic');
      expect(result.total).toBe(1);
    });
  });

  describe('batchDeleteBySessionId', () => {
    it('should batch delete topics using agentId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Create test topics
      await caller.createTopic({
        title: 'Topic to delete 1',
        sessionId: testSessionId,
      });

      await caller.createTopic({
        title: 'Topic to delete 2',
        sessionId: testSessionId,
      });

      // Batch delete using agentId
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

      // Create test topics
      await caller.createTopic({
        title: 'Topic to delete',
        sessionId: testSessionId,
      });

      // Batch delete using sessionId
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
    it('should batch delete topics by agentId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Agent-native topics stored with agentId directly
      await serverDB.insert(topics).values([
        { title: 'Agent Topic 1', agentId: testAgentId, userId },
        { title: 'Agent Topic 2', agentId: testAgentId, userId },
      ]);

      // Batch delete by agentId
      await caller.batchDeleteByAgentId({
        agentId: testAgentId,
      });

      const remainingTopics = await serverDB.select().from(topics).where(eq(topics.userId, userId));

      expect(remainingTopics).toHaveLength(0);
    });
  });

  // BM25 search requires pg_search extension (ParadeDB), not available in the
  // default integration test DB (PGlite). Run with TEST_SERVER_DB=1 +
  // DATABASE_TEST_URL pointing at a ParadeDB instance to exercise these.
  describe.skip('searchTopics', () => {
    it('should search topics using agentId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Topics are agent-native: stored with agentId directly.
      await serverDB.insert(topics).values([
        { agentId: testAgentId, title: 'TypeScript Discussion', userId },
        { agentId: testAgentId, title: 'JavaScript Basics', userId },
      ]);

      const result = await caller.searchTopics({
        agentId: testAgentId,
        keywords: 'TypeScript',
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toContain('TypeScript');
    });

    // Regression for the "No topics match these filters" bug: topics created by
    // the new agent system carry `agentId` directly with a NULL `sessionId`.
    // The old search resolved agentId -> sessionId and filtered by the
    // container only, so these rows were never matched even though the topics
    // list (which filters by agentId) showed them.
    it('should find agentId-scoped topics that have no sessionId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Insert a topic the way the agent runtime does: agentId set, sessionId null.
      await serverDB.insert(topics).values({
        agentId: testAgentId,
        sessionId: null,
        title: 'rinabrown84@gmail.com',
        userId,
      });

      const result = await caller.searchTopics({
        agentId: testAgentId,
        keywords: 'rinabrown84@gmail.com',
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toBe('rinabrown84@gmail.com');
    });

    // The agent scope mirrors the topics list exactly (agentId only). A row that
    // shares this agent's resolved session but is owned by a DIFFERENT agent
    // must not leak in — the bug the constrained-session-fallback review flagged.
    it('should not leak another agent topic that shares the session mapping', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      const otherAgentId = await createTestAgent(serverDB, userId);

      await serverDB.insert(topics).values([
        { agentId: testAgentId, title: 'mine rinabrown84@gmail.com', userId },
        // Same session, different agent — used to leak via the session fallback.
        {
          agentId: otherAgentId,
          sessionId: testSessionId,
          title: 'theirs rinabrown84@gmail.com',
          userId,
        },
      ]);

      const result = await caller.searchTopics({
        agentId: testAgentId,
        keywords: 'rinabrown84@gmail.com',
      });

      expect(result.map((t) => t.title)).toEqual(['mine rinabrown84@gmail.com']);
    });
  });

  describe('updateTopic', () => {
    it('should update topic with agentId in value', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Create test topic
      const topicId = await caller.createTopic({
        title: 'Original Title',
        sessionId: testSessionId,
      });

      // Create another agent and session
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

      // Update topic, specifying new association using agentId
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
    it('should backfill agentId for legacy session-only topics on query', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Legacy topic: sessionId set, agentId still null (pre-migration data)
      const [legacyTopic] = await serverDB
        .insert(topics)
        .values({ title: 'Legacy Topic', sessionId: testSessionId, agentId: null, userId })
        .returning();

      // Querying the agent triggers the background backfill via after().
      await caller.getTopics({ agentId: testAgentId });

      // Wait for the after() callback to run
      await new Promise((resolve) => setTimeout(resolve, 100));

      const [migrated] = await serverDB.select().from(topics).where(eq(topics.id, legacyTopic.id));
      expect(migrated.agentId).toBe(testAgentId);
    });

    it('should not change topics that already have agentId', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      const [topicWithAgentId] = await serverDB
        .insert(topics)
        .values({ title: 'New Topic', sessionId: testSessionId, agentId: testAgentId, userId })
        .returning();

      await caller.getTopics({ agentId: testAgentId });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const [afterQuery] = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, topicWithAgentId.id));
      expect(afterQuery.agentId).toBe(testAgentId);
    });

    it('should only backfill topics under the queried agent session', async () => {
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

      const [topic1] = await serverDB
        .insert(topics)
        .values({ title: 'Topic 1', sessionId: testSessionId, agentId: null, userId })
        .returning();
      const [topic2] = await serverDB
        .insert(topics)
        .values({ title: 'Topic 2', sessionId: otherSession.id, agentId: null, userId })
        .returning();

      const caller = topicRouter.createCaller(createTestContext(userId));
      await caller.getTopics({ agentId: testAgentId });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const [migrated1] = await serverDB.select().from(topics).where(eq(topics.id, topic1.id));
      const [migrated2] = await serverDB.select().from(topics).where(eq(topics.id, topic2.id));
      expect(migrated1.agentId).toBe(testAgentId);
      expect(migrated2.agentId).toBeNull();
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

    it('should backfill agentId for legacy inbox topics on query', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Legacy inbox topic: all owner columns null
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

      // Query with isInbox=true triggers the background backfill
      await caller.getTopics({ agentId: inboxAgentId, isInbox: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

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

      // Create original topic
      const originalId = await caller.createTopic({
        title: 'Original Topic',
        sessionId: testSessionId,
      });

      // Clone topic
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

      // Delete the first two
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

      const allTopics = await caller.queryTopics();

      expect(allTopics).toHaveLength(2);
    });

    it('should check if user has topics', async () => {
      const caller = topicRouter.createCaller(createTestContext(userId));

      // Initially there should be no topics
      const hasNoTopics = await caller.hasTopics();
      expect(hasNoTopics).toBe(true); // Note: hasTopics returns count === 0

      // After creating a topic
      await caller.createTopic({
        title: 'First Topic',
        sessionId: testSessionId,
      });

      const hasTopicsAfter = await caller.hasTopics();
      expect(hasTopicsAfter).toBe(false); // count !== 0
    });
  });
});
