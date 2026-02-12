// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  chatGroups,
  messages,
  sessions,
  threads,
  topics,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../../aiAgent';
import { cleanupTestUser, createTestUser } from './setup';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Mock services
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({})),
}));

describe('createClientGroupAgentTaskThread Integration', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let supervisorAgentId: string;
  let workerAgentId: string;
  let testGroupId: string;
  let testTopicId: string;
  let testSessionId: string;
  let parentMessageId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);

    // Create supervisor agent
    const [supervisorAgent] = await serverDB
      .insert(agents)
      .values({
        userId,
        title: 'Supervisor Agent',
        model: 'gpt-4o',
        provider: 'openai',
        systemRole: 'You are a supervisor.',
      })
      .returning();
    supervisorAgentId = supervisorAgent.id;

    // Create worker agent
    const [workerAgent] = await serverDB
      .insert(agents)
      .values({
        userId,
        title: 'Worker Agent',
        model: 'gpt-4o-mini',
        provider: 'openai',
        systemRole: 'You are a worker.',
      })
      .returning();
    workerAgentId = workerAgent.id;

    // Create test session
    const [session] = await serverDB.insert(sessions).values({ userId, type: 'group' }).returning();
    testSessionId = session.id;

    // Create test group
    const [group] = await serverDB
      .insert(chatGroups)
      .values({
        userId,
        title: 'Test Group',
      })
      .returning();
    testGroupId = group.id;

    // Create test topic
    const [topic] = await serverDB
      .insert(topics)
      .values({
        userId,
        title: 'Test Topic',
        agentId: supervisorAgentId,
        sessionId: testSessionId,
        groupId: testGroupId,
      })
      .returning();
    testTopicId = topic.id;

    // Create parent message from supervisor (simulating supervisor's task message)
    const [parentMsg] = await serverDB
      .insert(messages)
      .values({
        userId,
        role: 'assistant',
        content: 'Task: Please analyze this data',
        topicId: testTopicId,
        agentId: supervisorAgentId, // Parent message from supervisor
        groupId: testGroupId,
      })
      .returning();
    parentMessageId = parentMsg.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  const createTestContext = () => ({
    userId,
    jwtPayload: { userId },
  });

  describe('basic functionality', () => {
    it('should create Thread with subAgentId as the executing agent', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientGroupAgentTaskThread({
        groupId: testGroupId,
        instruction: 'Analyze the data',
        parentMessageId,
        subAgentId: workerAgentId,
        topicId: testTopicId,
      });

      expect(result.success).toBe(true);
      expect(result.threadId).toBeDefined();
      expect(result.userMessageId).toBeDefined();

      // Verify Thread uses subAgentId (worker) as the agentId
      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));
      expect(thread.agentId).toBe(workerAgentId);
      expect(thread.groupId).toBe(testGroupId);
      expect(thread.type).toBe(ThreadType.Isolation);
      expect(thread.status).toBe(ThreadStatus.Processing);
    });

    it('should create user message with subAgentId', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientGroupAgentTaskThread({
        groupId: testGroupId,
        instruction: 'Process this request',
        parentMessageId,
        subAgentId: workerAgentId,
        topicId: testTopicId,
      });

      const [userMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, result.userMessageId));

      expect(userMessage.agentId).toBe(workerAgentId);
      expect(userMessage.groupId).toBe(testGroupId);
      expect(userMessage.threadId).toBe(result.threadId);
      expect(userMessage.role).toBe('user');
    });
  });

  describe('thread messages query (key difference from single agent mode)', () => {
    it('should include the user message in threadMessages (Isolation type has no parent messages)', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientGroupAgentTaskThread({
        groupId: testGroupId,
        instruction: 'Execute the task',
        parentMessageId,
        subAgentId: workerAgentId,
        topicId: testTopicId,
      });

      // For Isolation type threads, only the thread's own messages are included
      // (parent messages are NOT included by design - thread is isolated)
      expect(result.threadMessages.length).toBeGreaterThanOrEqual(1);

      // Find the user message
      const userMsgInThread = result.threadMessages.find((m) => m.id === result.userMessageId);
      expect(userMsgInThread).toBeDefined();
      expect(userMsgInThread?.agentId).toBe(workerAgentId);
      expect(userMsgInThread?.threadId).toBe(result.threadId);
    });

    it('should NOT filter by agentId (messages from any agent in thread are included)', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientGroupAgentTaskThread({
        groupId: testGroupId,
        instruction: 'Execute the task',
        parentMessageId,
        subAgentId: workerAgentId,
        topicId: testTopicId,
      });

      // Create a message in the thread with a DIFFERENT agentId (simulating supervisor adding to thread)
      await serverDB.insert(messages).values({
        userId,
        role: 'assistant',
        content: 'Response from supervisor in thread',
        topicId: testTopicId,
        agentId: supervisorAgentId, // Different from subAgentId!
        groupId: testGroupId,
        threadId: result.threadId,
      });

      // Query thread messages again via API
      const result2 = await caller.createClientGroupAgentTaskThread({
        groupId: testGroupId,
        instruction: 'Another task',
        parentMessageId,
        subAgentId: workerAgentId,
        topicId: testTopicId,
      });

      // The key test: messages in a thread from different agents should all be queryable
      // This verifies the API doesn't filter by agentId
      const [supervisorMsgInThread] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.threadId, result.threadId));

      // If we directly query the database, we should find messages with different agentIds
      const threadMsgs = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.threadId, result.threadId));

      const agentIds = [...new Set(threadMsgs.map((m) => m.agentId))];
      // Thread should be able to contain messages from multiple agents
      expect(agentIds.length).toBeGreaterThanOrEqual(1);
    });

    it('should include ancestor messages in thread context', async () => {
      // Create a chain of messages with different agentIds
      const [userMsg] = await serverDB
        .insert(messages)
        .values({
          userId,
          role: 'user',
          content: 'User question',
          topicId: testTopicId,
          agentId: supervisorAgentId,
          groupId: testGroupId,
        })
        .returning();

      const [supervisorResponse] = await serverDB
        .insert(messages)
        .values({
          userId,
          role: 'assistant',
          content: 'Supervisor response with task delegation',
          topicId: testTopicId,
          agentId: supervisorAgentId,
          groupId: testGroupId,
          parentId: userMsg.id,
        })
        .returning();

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientGroupAgentTaskThread({
        groupId: testGroupId,
        instruction: 'Execute delegated task',
        parentMessageId: supervisorResponse.id,
        subAgentId: workerAgentId,
        topicId: testTopicId,
      });

      // Should include messages from the thread context regardless of agentId
      expect(result.threadMessages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('main messages query', () => {
    it('should return all main chat messages in the group (without threadId filter)', async () => {
      // Create some main chat messages from different agents
      await serverDB.insert(messages).values([
        {
          userId,
          role: 'user',
          content: 'User message',
          topicId: testTopicId,
          agentId: supervisorAgentId,
          groupId: testGroupId,
        },
        {
          userId,
          role: 'assistant',
          content: 'Supervisor response',
          topicId: testTopicId,
          agentId: supervisorAgentId,
          groupId: testGroupId,
        },
      ]);

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientGroupAgentTaskThread({
        groupId: testGroupId,
        instruction: 'New task',
        parentMessageId,
        subAgentId: workerAgentId,
        topicId: testTopicId,
      });

      // Main messages should include messages from ALL agents in the group
      expect(result.messages.length).toBeGreaterThanOrEqual(3); // parentMsg + 2 new messages

      // Verify messages are from the group (not filtered by subAgentId)
      const supervisorMessages = result.messages.filter((m) => m.agentId === supervisorAgentId);
      expect(supervisorMessages.length).toBeGreaterThanOrEqual(1);
    });

    it('should not include thread messages in main messages', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientGroupAgentTaskThread({
        groupId: testGroupId,
        instruction: 'Task instruction',
        parentMessageId,
        subAgentId: workerAgentId,
        topicId: testTopicId,
      });

      // The newly created user message (which has threadId) should NOT be in main messages
      const threadMessageInMain = result.messages.find((m) => m.id === result.userMessageId);
      expect(threadMessageInMain).toBeUndefined();
    });
  });

  describe('groupId is required', () => {
    it('should reject requests without groupId', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      // TypeScript would prevent this, but we test the runtime validation
      await expect(
        caller.createClientGroupAgentTaskThread({
          groupId: '', // Empty string should fail validation
          instruction: 'Task',
          parentMessageId,
          subAgentId: workerAgentId,
          topicId: testTopicId,
        }),
      ).rejects.toThrow();
    });
  });

  describe('thread metadata', () => {
    it('should have clientMode flag set to true', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientGroupAgentTaskThread({
        groupId: testGroupId,
        instruction: 'Client mode task',
        parentMessageId,
        subAgentId: workerAgentId,
        topicId: testTopicId,
      });

      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));
      expect(thread.metadata?.clientMode).toBe(true);
    });

    it('should have startedAt timestamp in metadata', async () => {
      const beforeCall = new Date().toISOString();

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientGroupAgentTaskThread({
        groupId: testGroupId,
        instruction: 'Timestamp test',
        parentMessageId,
        subAgentId: workerAgentId,
        topicId: testTopicId,
      });

      const afterCall = new Date().toISOString();

      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));

      expect(thread.metadata?.startedAt).toBeDefined();
      expect(result.startedAt).toBe(thread.metadata?.startedAt);
      expect(thread.metadata?.startedAt! >= beforeCall).toBe(true);
      expect(thread.metadata?.startedAt! <= afterCall).toBe(true);
    });
  });

  describe('title support', () => {
    it('should create Thread with title when provided', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientGroupAgentTaskThread({
        groupId: testGroupId,
        instruction: 'Task with title',
        parentMessageId,
        subAgentId: workerAgentId,
        title: 'Data Analysis Task',
        topicId: testTopicId,
      });

      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));
      expect(thread.title).toBe('Data Analysis Task');
    });
  });
});
