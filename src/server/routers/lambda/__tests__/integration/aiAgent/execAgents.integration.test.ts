// @vitest-environment node
/**
 * Integration tests for execAgents (batch execution) router
 *
 * Note: AgentStateManager and StreamEventManager will automatically use
 * InMemory implementations when Redis is not available (test environment).
 */
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inMemoryAgentStateManager } from '@/server/modules/AgentRuntime/InMemoryAgentStateManager';
import { inMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';

import { aiAgentRouter } from '../../../aiAgent';
import { cleanupTestUser, createTestUser } from '../setup';
import { createMockResponsesAPIStream } from './helpers';

// Set fake API key for testing to bypass OpenAI SDK validation
process.env.OPENAI_API_KEY = 'sk-test-fake-api-key-for-testing';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Mock FileService to avoid S3 environment variable requirements
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockImplementation((path: string) => (path ? `/files${path}` : null)),
  })),
}));

let mockResponsesCreate: any;

let serverDB: LobeChatDatabase;
let userId: string;
let testAgentId: string;
let testAgent2Id: string;

const createTestContext = () => ({
  jwtPayload: { userId },
  userId,
});

beforeEach(async () => {
  // Setup test database
  serverDB = await getTestDB();
  testDB = serverDB;
  userId = await createTestUser(serverDB);

  // Create test agent with gpt-5-pro (uses Responses API)
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

  // Create a second test agent for batch testing
  const [agent2] = await serverDB
    .insert(agents)
    .values({
      model: 'gpt-5-pro',
      provider: 'openai',
      systemRole: 'You are a helpful coding assistant.',
      title: 'Test Assistant 2',
      userId,
    })
    .returning();
  testAgent2Id = agent2.id;

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

describe('Batch Execution (execAgents)', () => {
  it('should execute multiple agents in parallel', async () => {
    const responseContent = 'Hello from batch execution!';
    mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream(responseContent) as any);

    const caller = aiAgentRouter.createCaller(createTestContext());

    const result = await caller.execAgents({
      parallel: true,
      tasks: [
        { agentId: testAgentId, autoStart: false, prompt: 'Task 1: Hello' },
        { agentId: testAgent2Id, autoStart: false, prompt: 'Task 2: World' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.summary).toEqual({
      failed: 0,
      succeeded: 2,
      total: 2,
    });

    expect(result.results[0]).toMatchObject({
      success: true,
      taskIndex: 0,
      operationId: expect.stringMatching(
        /^op_\d+_agt_.+_tpc_.(?:[^\n\r_\u2028\u2029]*_[^\w\n\r\u2028\u2029])*[^\n\r_\u2028\u2029]*_\w+(?:[^\w\n\r\u2028\u2029](?:[^\n\r_\u2028\u2029]*_[^\w\n\r\u2028\u2029])*[^\n\r_\u2028\u2029]*_\w+)*$/,
      ),
    });
    expect(result.results[1]).toMatchObject({
      success: true,
      taskIndex: 1,
      operationId: expect.stringMatching(
        /^op_\d+_agt_.+_tpc_.(?:[^\n\r_\u2028\u2029]*_[^\w\n\r\u2028\u2029])*[^\n\r_\u2028\u2029]*_\w+(?:[^\w\n\r\u2028\u2029](?:[^\n\r_\u2028\u2029]*_[^\w\n\r\u2028\u2029])*[^\n\r_\u2028\u2029]*_\w+)*$/,
      ),
    });

    expect(result.results[0].operationId).not.toBe(result.results[1].operationId);
  });

  it('should execute multiple agents sequentially when parallel=false', async () => {
    const responseContent = 'Sequential execution response';
    mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream(responseContent) as any);

    const caller = aiAgentRouter.createCaller(createTestContext());

    const result = await caller.execAgents({
      parallel: false,
      tasks: [
        { agentId: testAgentId, autoStart: false, prompt: 'Sequential Task 1' },
        { agentId: testAgent2Id, autoStart: false, prompt: 'Sequential Task 2' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.summary.succeeded).toBe(2);
  });

  it('should handle partial failures gracefully', async () => {
    mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream('Success response') as any);

    const caller = aiAgentRouter.createCaller(createTestContext());

    const result = await caller.execAgents({
      tasks: [
        { agentId: testAgentId, autoStart: false, prompt: 'Valid task' },
        { agentId: 'non-existent-agent', autoStart: false, prompt: 'Invalid task' },
        { agentId: testAgent2Id, autoStart: false, prompt: 'Another valid task' },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.results).toHaveLength(3);

    expect(result.results[0].success).toBe(true);
    expect(result.results[0].taskIndex).toBe(0);

    expect(result.results[1].success).toBe(false);
    expect(result.results[1].taskIndex).toBe(1);
    expect(result.results[1].error).toBeDefined();

    expect(result.results[2].success).toBe(true);
    expect(result.results[2].taskIndex).toBe(2);

    expect(result.summary).toEqual({
      failed: 1,
      succeeded: 2,
      total: 3,
    });
  });

  it('should create separate topics for each task', async () => {
    mockResponsesCreate.mockResolvedValue(
      createMockResponsesAPIStream('Response for separate topics') as any,
    );

    const caller = aiAgentRouter.createCaller(createTestContext());

    await caller.execAgents({
      tasks: [
        { agentId: testAgentId, autoStart: false, prompt: 'Topic 1 prompt' },
        { agentId: testAgentId, autoStart: false, prompt: 'Topic 2 prompt' },
      ],
    });

    const createdTopics = await serverDB
      .select()
      .from(topics)
      .where(eq(topics.agentId, testAgentId));

    expect(createdTopics).toHaveLength(2);
    expect(createdTopics.map((t) => t.title).sort()).toEqual(['Topic 1 prompt', 'Topic 2 prompt']);
  });

  it('should support autoStart for batch tasks', async () => {
    mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream('Auto start test') as any);

    const caller = aiAgentRouter.createCaller(createTestContext());

    const result = await caller.execAgents({
      tasks: [
        { agentId: testAgentId, autoStart: true, prompt: 'Auto start task 1' },
        { agentId: testAgent2Id, autoStart: false, prompt: 'Manual start task 2' },
      ],
    });

    expect(result.success).toBe(true);

    expect(result.results[0].autoStarted).toBe(true);
    expect(result.results[1].autoStarted).toBe(false);
  });
});
