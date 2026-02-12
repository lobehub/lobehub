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

// Mock AiAgentService - not needed for createClientTaskThread but required for aiAgentProcedure
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({})),
}));

// Mock AgentRuntimeService
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({})),
}));

// Mock AiChatService
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({})),
}));

describe('createClientTaskThread Integration', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let testAgentId: string;
  let testGroupId: string;
  let testTopicId: string;
  let testSessionId: string;
  let parentMessageId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);

    // Create test agent
    const [agent] = await serverDB
      .insert(agents)
      .values({
        userId,
        title: 'Test Agent',
        model: 'gpt-4o-mini',
        provider: 'openai',
        systemRole: 'You are a helpful assistant.',
      })
      .returning();
    testAgentId = agent.id;

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
        agentId: testAgentId,
        sessionId: testSessionId,
        groupId: testGroupId,
      })
      .returning();
    testTopicId = topic.id;

    // Create parent message (simulating a task message from supervisor)
    const [parentMsg] = await serverDB
      .insert(messages)
      .values({
        userId,
        role: 'assistant',
        content: 'Task: Research the topic',
        topicId: testTopicId,
        agentId: testAgentId,
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
    it('should create Thread and user message successfully', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientTaskThread({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Please analyze this data',
        parentMessageId,
        topicId: testTopicId,
      });

      // Verify return values
      expect(result.success).toBe(true);
      expect(result.threadId).toBeDefined();
      expect(result.userMessageId).toBeDefined();
      expect(result.startedAt).toBeDefined();
      expect(result.threadMessages).toBeDefined();
      expect(result.messages).toBeDefined();

      // Verify Thread was created in database
      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));

      expect(thread).toBeDefined();
      expect(thread.agentId).toBe(testAgentId);
      expect(thread.groupId).toBe(testGroupId);
      expect(thread.topicId).toBe(testTopicId);
      expect(thread.sourceMessageId).toBe(parentMessageId);
      expect(thread.type).toBe(ThreadType.Isolation);
      expect(thread.status).toBe(ThreadStatus.Processing);
      expect(thread.userId).toBe(userId);

      // Verify metadata
      expect(thread.metadata).toBeDefined();
      expect(thread.metadata?.clientMode).toBe(true);
      expect(thread.metadata?.startedAt).toBe(result.startedAt);

      // Verify user message was created in database
      const [userMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, result.userMessageId));

      expect(userMessage).toBeDefined();
      expect(userMessage.role).toBe('user');
      expect(userMessage.content).toBe('Please analyze this data');
      expect(userMessage.agentId).toBe(testAgentId);
      expect(userMessage.topicId).toBe(testTopicId);
      expect(userMessage.threadId).toBe(result.threadId);
      expect(userMessage.parentId).toBe(parentMessageId);
      expect(userMessage.userId).toBe(userId);
    });

    it('should create Thread with title when provided', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientTaskThread({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Analyze the data',
        parentMessageId,
        title: 'Data Analysis Task',
        topicId: testTopicId,
      });

      expect(result.success).toBe(true);

      // Verify Thread title in database
      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));

      expect(thread.title).toBe('Data Analysis Task');
    });
  });

  describe('single agent mode (without groupId)', () => {
    it('should create Thread without groupId for single agent mode', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientTaskThread({
        agentId: testAgentId,
        // No groupId provided
        instruction: 'Single agent task instruction',
        parentMessageId,
        topicId: testTopicId,
      });

      expect(result.success).toBe(true);

      // Verify Thread has no groupId
      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));

      expect(thread.agentId).toBe(testAgentId);
      expect(thread.groupId).toBeNull();
      expect(thread.type).toBe(ThreadType.Isolation);
    });
  });

  describe('returned messages', () => {
    it('should return thread messages including the created user message', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientTaskThread({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Test instruction',
        parentMessageId,
        topicId: testTopicId,
      });

      // Verify threadMessages includes the created user message
      expect(result.threadMessages).toBeInstanceOf(Array);
      expect(result.threadMessages.length).toBeGreaterThanOrEqual(1);

      const userMsg = result.threadMessages.find((m) => m.id === result.userMessageId);
      expect(userMsg).toBeDefined();
      expect(userMsg?.role).toBe('user');
      expect(userMsg?.content).toBe('Test instruction');
      expect(userMsg?.threadId).toBe(result.threadId);
    });

    it('should return main chat messages (messages without threadId)', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      // Create some main chat messages first (with groupId to match the query)
      await serverDB.insert(messages).values([
        {
          userId,
          role: 'user',
          content: 'Main chat message 1',
          topicId: testTopicId,
          agentId: testAgentId,
          groupId: testGroupId,
        },
        {
          userId,
          role: 'assistant',
          content: 'Main chat response 1',
          topicId: testTopicId,
          agentId: testAgentId,
          groupId: testGroupId,
        },
      ]);

      const result = await caller.createClientTaskThread({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Thread instruction',
        parentMessageId,
        topicId: testTopicId,
      });

      // Verify messages array contains main chat messages (without threadId)
      expect(result.messages).toBeInstanceOf(Array);

      // Main chat messages should not include the thread user message
      const threadMessageInMain = result.messages.find((m) => m.id === result.userMessageId);
      expect(threadMessageInMain).toBeUndefined();

      // Main chat messages should include the parent message and other main messages
      const parentMsgInMain = result.messages.find((m) => m.id === parentMessageId);
      expect(parentMsgInMain).toBeDefined();
    });
  });

  describe('multiple threads', () => {
    it('should create multiple threads for the same topic', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      // Create first thread
      const result1 = await caller.createClientTaskThread({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'First task',
        parentMessageId,
        topicId: testTopicId,
      });

      // Create second parent message for second thread
      const [secondParentMsg] = await serverDB
        .insert(messages)
        .values({
          userId,
          role: 'assistant',
          content: 'Second task message',
          topicId: testTopicId,
          agentId: testAgentId,
        })
        .returning();

      // Create second thread
      const result2 = await caller.createClientTaskThread({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Second task',
        parentMessageId: secondParentMsg.id,
        topicId: testTopicId,
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.threadId).not.toBe(result2.threadId);

      // Verify both threads exist in database
      const topicThreads = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.topicId, testTopicId));

      expect(topicThreads.length).toBe(2);

      // Verify each thread has its own user message
      const thread1Messages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.threadId, result1.threadId));
      const thread2Messages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.threadId, result2.threadId));

      expect(thread1Messages.length).toBeGreaterThanOrEqual(1);
      expect(thread2Messages.length).toBeGreaterThanOrEqual(1);
      expect(thread1Messages[0].content).toBe('First task');
      expect(thread2Messages[0].content).toBe('Second task');
    });
  });

  describe('different agents', () => {
    it('should create threads for different agents in the same topic', async () => {
      // Create second agent
      const [agent2] = await serverDB
        .insert(agents)
        .values({
          userId,
          title: 'Second Agent',
          model: 'gpt-4o-mini',
          provider: 'openai',
          systemRole: 'You are another assistant.',
        })
        .returning();

      const caller = aiAgentRouter.createCaller(createTestContext());

      // Create thread for first agent
      const result1 = await caller.createClientTaskThread({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Task for agent 1',
        parentMessageId,
        topicId: testTopicId,
      });

      // Create thread for second agent
      const result2 = await caller.createClientTaskThread({
        agentId: agent2.id,
        groupId: testGroupId,
        instruction: 'Task for agent 2',
        parentMessageId,
        topicId: testTopicId,
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Verify threads have different agentIds
      const [thread1] = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.id, result1.threadId));
      const [thread2] = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.id, result2.threadId));

      expect(thread1.agentId).toBe(testAgentId);
      expect(thread2.agentId).toBe(agent2.id);
    });
  });

  describe('thread metadata', () => {
    it('should have clientMode flag set to true', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientTaskThread({
        agentId: testAgentId,
        instruction: 'Client mode task',
        parentMessageId,
        topicId: testTopicId,
      });

      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));

      expect(thread.metadata?.clientMode).toBe(true);
    });

    it('should have startedAt timestamp in metadata', async () => {
      const beforeCall = new Date().toISOString();

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientTaskThread({
        agentId: testAgentId,
        instruction: 'Timestamp test task',
        parentMessageId,
        topicId: testTopicId,
      });

      const afterCall = new Date().toISOString();

      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));

      expect(thread.metadata?.startedAt).toBeDefined();
      expect(result.startedAt).toBe(thread.metadata?.startedAt);

      // Verify timestamp is within the call window
      expect(thread.metadata?.startedAt! >= beforeCall).toBe(true);
      expect(thread.metadata?.startedAt! <= afterCall).toBe(true);
    });
  });

  describe('user message properties', () => {
    it('should create user message with correct parentId linking to source message', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientTaskThread({
        agentId: testAgentId,
        instruction: 'Task with parent link',
        parentMessageId,
        topicId: testTopicId,
      });

      const [userMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, result.userMessageId));

      // User message should have parentId pointing to the source message
      expect(userMessage.parentId).toBe(parentMessageId);

      // Thread should have sourceMessageId pointing to the same message
      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));
      expect(thread.sourceMessageId).toBe(parentMessageId);
    });

    it('should create user message with role=user', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientTaskThread({
        agentId: testAgentId,
        instruction: 'Role test',
        parentMessageId,
        topicId: testTopicId,
      });

      const [userMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, result.userMessageId));

      expect(userMessage.role).toBe('user');
    });
  });

  describe('database integrity', () => {
    it('should maintain referential integrity between thread and message', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientTaskThread({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Integrity test',
        parentMessageId,
        topicId: testTopicId,
      });

      // Query messages with threadId
      const threadMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.threadId, result.threadId));

      expect(threadMessages.length).toBeGreaterThanOrEqual(1);

      // All thread messages should have same topicId
      threadMessages.forEach((msg) => {
        expect(msg.topicId).toBe(testTopicId);
        expect(msg.threadId).toBe(result.threadId);
      });

      // Thread should reference correct topic
      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));
      expect(thread.topicId).toBe(testTopicId);
    });

    it('should correctly associate thread with agent and group', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.createClientTaskThread({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Association test',
        parentMessageId,
        topicId: testTopicId,
      });

      // Verify all associations in database
      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, result.threadId));
      const [userMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, result.userMessageId));

      // Thread associations
      expect(thread.agentId).toBe(testAgentId);
      expect(thread.groupId).toBe(testGroupId);
      expect(thread.topicId).toBe(testTopicId);
      expect(thread.userId).toBe(userId);

      // Message associations
      expect(userMessage.agentId).toBe(testAgentId);
      expect(userMessage.topicId).toBe(testTopicId);
      expect(userMessage.threadId).toBe(result.threadId);
      expect(userMessage.userId).toBe(userId);
    });
  });
});
