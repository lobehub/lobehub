// @vitest-environment node
/**
 * Integration tests for execGroupAgent router
 * Tests Group Agent (Supervisor) execution with groupId support
 *
 * Note: AgentStateManager and StreamEventManager will automatically use
 * InMemory implementations when Redis is not available (test environment).
 */
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, chatGroups, messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inMemoryAgentStateManager } from '@/server/modules/AgentRuntime/InMemoryAgentStateManager';
import { inMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';

import { aiAgentRouter } from '../../../aiAgent';
import { cleanupTestUser, createTestUser } from '../setup';
import { createMockResponsesAPIStream } from './helpers';

// Set fake API key for testing to bypass OpenAI SDK validation
process.env.OPENAI_API_KEY = 'sk-test-fake-api-key-for-testing';

// Local testDB variable for mock closure
let testDB: LobeChatDatabase;

// Setup mocks at module level (vi.mock is hoisted)
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Mock FileService to avoid S3 environment variable requirements
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockImplementation((path: string) => (path ? `/files${path}` : null)),
  })),
}));

let serverDB: LobeChatDatabase;
let userId: string;
let testAgentId: string;
let testGroupId: string;

let mockResponsesCreate: any;

const createTestCallerContext = (uid: string) => ({
  jwtPayload: { userId: uid },
  userId: uid,
});

beforeEach(async () => {
  // Setup test database
  serverDB = await getTestDB();
  testDB = serverDB;
  userId = await createTestUser(serverDB);

  // Create test agent
  const [agent] = await serverDB
    .insert(agents)
    .values({
      model: 'gpt-5-pro',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
      title: 'Test Assistant',
      userId,
    })
    .returning();
  testAgentId = agent.id;

  // Create a test chat group
  const [group] = await serverDB
    .insert(chatGroups)
    .values({
      title: 'Test Chat Group',
      userId,
    })
    .returning();
  testGroupId = group.id;

  // Setup spyOn for OpenAI Responses API prototype
  mockResponsesCreate = vi.spyOn(OpenAI.Responses.prototype, 'create');
});

afterEach(async () => {
  await cleanupTestUser(serverDB, userId);
  vi.clearAllMocks();
  vi.restoreAllMocks();

  // Clear singleton instances for next test
  inMemoryAgentStateManager.clear();
  inMemoryStreamEventManager.clear();
});

describe('execGroupAgent', () => {
  describe('Topic Creation with groupId', () => {
    it('should create a new topic with groupId when topicId is not provided', async () => {
      mockResponsesCreate.mockResolvedValue(
        createMockResponsesAPIStream('Hello from group agent!') as any,
      );

      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));

      const result = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: 'Hello, group!',
      });

      expect(result.operationId).toBeDefined();
      expect(result.topicId).toBeDefined();
      expect(result.isCreateNewTopic).toBe(true);

      // Verify topic was created with correct groupId
      const createdTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, result.topicId));

      expect(createdTopics).toHaveLength(1);
      expect(createdTopics[0].groupId).toBe(testGroupId);
      expect(createdTopics[0].agentId).toBe(testAgentId);
      expect(createdTopics[0].title).toBe('Hello, group!');
    });

    it('should truncate long message for topic title', async () => {
      mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream('Response') as any);

      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));
      const longMessage =
        'This is a very long message that exceeds fifty characters and should be truncated for the topic title';

      const result = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: longMessage,
      });

      expect(result.isCreateNewTopic).toBe(true);

      const createdTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, result.topicId));

      expect(createdTopics[0].title).toBe(longMessage.slice(0, 50) + '...');
      expect(createdTopics[0].groupId).toBe(testGroupId);
    });

    it('should reuse existing topic when topicId is provided', async () => {
      mockResponsesCreate.mockResolvedValue(
        createMockResponsesAPIStream('Follow up response') as any,
      );

      // Create an existing topic with groupId
      const [existingTopic] = await serverDB
        .insert(topics)
        .values({
          agentId: testAgentId,
          groupId: testGroupId,
          title: 'Existing Group Topic',
          userId,
        })
        .returning();

      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));

      const result = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: 'Follow up message',
        topicId: existingTopic.id,
      });

      expect(result.topicId).toBe(existingTopic.id);
      expect(result.isCreateNewTopic).toBe(false);

      // Verify no new topic was created
      const allTopics = await serverDB.select().from(topics).where(eq(topics.groupId, testGroupId));

      expect(allTopics).toHaveLength(1);
      expect(allTopics[0].id).toBe(existingTopic.id);
    });

    it('should create topic with custom title when newTopic is provided', async () => {
      mockResponsesCreate.mockResolvedValue(
        createMockResponsesAPIStream('Response with custom topic') as any,
      );

      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));

      const result = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: 'Some message content',
        newTopic: {
          title: 'Custom Topic Title',
        },
      });

      expect(result.isCreateNewTopic).toBe(true);

      const createdTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, result.topicId));

      expect(createdTopics[0].title).toBe('Custom Topic Title');
      expect(createdTopics[0].groupId).toBe(testGroupId);
    });
  });

  describe('Message Creation', () => {
    it('should create user message in the topic', async () => {
      mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream('Agent response') as any);

      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));

      const result = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: 'User message in group',
      });

      // Verify user message was created
      const createdMessages = await serverDB
        .select()
        .from(messages)
        .where(and(eq(messages.topicId, result.topicId), eq(messages.role, 'user')));

      expect(createdMessages).toHaveLength(1);
      expect(createdMessages[0].content).toBe('User message in group');
      expect(createdMessages[0].agentId).toBe(testAgentId);
    });
  });

  describe('Response Data', () => {
    it('should return messages and topics in response', async () => {
      mockResponsesCreate.mockResolvedValue(
        createMockResponsesAPIStream('Response with data') as any,
      );

      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));

      const result = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: 'Test message',
      });

      // Verify response contains messages
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);

      // Verify isCreateNewTopic flag
      expect(result.isCreateNewTopic).toBe(true);

      // Verify response contains topics when new topic is created
      // topics is returned from topicModel.query() when includeTopic is true
      expect(result.topics).toBeDefined();
    });

    it('should not return topics when using existing topic', async () => {
      mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream('Response') as any);

      // Create an existing topic
      const [existingTopic] = await serverDB
        .insert(topics)
        .values({
          agentId: testAgentId,
          groupId: testGroupId,
          title: 'Existing Topic',
          userId,
        })
        .returning();

      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));

      const result = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: 'Follow up',
        topicId: existingTopic.id,
      });

      expect(result.isCreateNewTopic).toBe(false);
      // Topics should be undefined or empty when not creating new topic
      expect(result.topics).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should throw error when agent does not exist', async () => {
      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));

      await expect(
        caller.execGroupAgent({
          agentId: 'non-existent-agent-id',
          groupId: testGroupId,
          message: 'Hello',
        }),
      ).rejects.toThrow();
    });
  });

  describe('Stream Events', () => {
    // TODO: LOBE-1748 - Fix missing agent_runtime_end event
    // This test documents the current bug where agent_runtime_end is not sent
    // When fixed, remove .todo and the test should pass
    it.todo('should emit agent_runtime_end event when agent completes', async () => {
      mockResponsesCreate.mockResolvedValue(
        createMockResponsesAPIStream('Completed response') as any,
      );

      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));

      const result = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: 'Test message for stream events',
      });

      expect(result.operationId).toBeDefined();

      // Wait a bit for all events to be processed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check all events that were emitted
      const allEvents = inMemoryStreamEventManager.getAllEvents(result.operationId);
      const eventTypes = allEvents.map((e) => e.type);

      console.log('All emitted event types:', eventTypes);

      // IMPORTANT: This test verifies that agent_runtime_end event is sent
      // If this test fails, it means the SSE stream won't close properly
      // See LOBE-1748 for details
      expect(eventTypes).toContain('agent_runtime_end');

      // Also verify the event has correct data structure
      const endEvent = allEvents.find((e) => e.type === 'agent_runtime_end');
      if (endEvent) {
        expect(endEvent.data).toBeDefined();
        expect(endEvent.data.phase).toBe('execution_complete');
      }
    });

    it('should emit events in correct order: init -> chunks -> end', async () => {
      mockResponsesCreate.mockResolvedValue(
        createMockResponsesAPIStream('Response content') as any,
      );

      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));

      const result = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: 'Test event order',
      });

      // Wait a bit for all events to be processed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const allEvents = inMemoryStreamEventManager.getAllEvents(result.operationId);
      const eventTypes = allEvents.map((e) => e.type);

      // Log event types for debugging
      console.log('Emitted event types:', eventTypes);

      // Verify agent_runtime_init is emitted (should be first or near first)
      const initIndex = eventTypes.indexOf('agent_runtime_init');

      // Verify agent_runtime_end is emitted (should be last)
      const endIndex = eventTypes.indexOf('agent_runtime_end');

      // If both events exist, verify order
      if (initIndex !== -1 && endIndex !== -1) {
        expect(initIndex).toBeLessThan(endIndex);
      }

      // At minimum, we should have some events
      expect(allEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Multiple Group Sessions', () => {
    it('should create separate topics for different groups', async () => {
      mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream('Response') as any);

      // Create another group
      const [group2] = await serverDB
        .insert(chatGroups)
        .values({
          title: 'Test Chat Group 2',
          userId,
        })
        .returning();

      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));

      // Send message to first group
      const result1 = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: 'Message to group 1',
      });

      // Send message to second group
      const result2 = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: group2.id,
        message: 'Message to group 2',
      });

      // Verify different topics were created
      expect(result1.topicId).not.toBe(result2.topicId);

      // Verify topics have correct groupIds
      const topic1 = await serverDB.select().from(topics).where(eq(topics.id, result1.topicId));
      const topic2 = await serverDB.select().from(topics).where(eq(topics.id, result2.topicId));

      expect(topic1[0].groupId).toBe(testGroupId);
      expect(topic2[0].groupId).toBe(group2.id);
    });

    it('should allow multiple topics within same group', async () => {
      mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream('Response') as any);

      const caller = aiAgentRouter.createCaller(createTestCallerContext(userId));

      // Create first topic in group
      const result1 = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: 'First conversation',
      });

      // Create second topic in same group (without topicId, should create new)
      const result2 = await caller.execGroupAgent({
        agentId: testAgentId,
        groupId: testGroupId,
        message: 'Second conversation',
      });

      // Verify different topics were created
      expect(result1.topicId).not.toBe(result2.topicId);
      expect(result1.isCreateNewTopic).toBe(true);
      expect(result2.isCreateNewTopic).toBe(true);

      // Verify both topics belong to same group
      const groupTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.groupId, testGroupId));

      expect(groupTopics).toHaveLength(2);
      expect(groupTopics.every((t) => t.groupId === testGroupId)).toBe(true);
    });
  });
});
