// @vitest-environment node
/**
 * Integration tests for execAgent router
 *
 * Note: AgentStateManager and StreamEventManager will automatically use
 * InMemory implementations when Redis is not available (test environment).
 */
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, messages, threads, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inMemoryAgentStateManager } from '@/server/modules/AgentRuntime/InMemoryAgentStateManager';
import { inMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';
import { ToolExecutionService } from '@/server/services/toolExecution';

import { aiAgentRouter } from '../../../aiAgent';
import { cleanupTestUser, createTestUser } from '../setup';
import {
  createMockResponsesAPIStream,
  createMockResponsesStream,
  waitForOperationComplete,
} from './helpers';

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

describe('execAgent', () => {
  describe('Basic execAgent Flow', () => {
    it('should create operation successfully with prompt', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());
      const prompt = "What's the weather of Hangzhou?";

      const result = await caller.execAgent({ agentId: testAgentId, prompt });

      expect(result.success).toBe(true);
      expect(result.operationId).toBeDefined();
      expect(result.operationId).toMatch(
        /^op_\d+_agt_.+_tpc_.(?:[^\n\r_\u2028\u2029]*_[^\w\n\r\u2028\u2029])*[^\n\r_\u2028\u2029]*_\w+(?:[^\w\n\r\u2028\u2029](?:[^\n\r_\u2028\u2029]*_[^\w\n\r\u2028\u2029])*[^\n\r_\u2028\u2029]*_\w+)*$/,
      );

      // Verify topic was created
      const createdTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.agentId, testAgentId));
      expect(createdTopics).toHaveLength(1);
      expect(createdTopics[0].title).toBe(prompt);

      // Verify user message and assistant message placeholder were created
      const createdMessages = await serverDB
        .select()
        .from(messages)
        .where(and(eq(messages.agentId, testAgentId), eq(messages.topicId, createdTopics[0].id)));

      expect(createdMessages).toHaveLength(2);

      const userMessage = createdMessages.find((m) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.content).toBe(prompt);

      const assistantMessage = createdMessages.find((m) => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.parentId).toBe(userMessage?.id);
    });

    it('should create a new topic when topicId is not provided', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.execAgent({
        agentId: testAgentId,
        prompt: 'Hello, how are you?',
      });

      expect(result.success).toBe(true);

      const createdTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.agentId, testAgentId));

      expect(createdTopics).toHaveLength(1);
      expect(createdTopics[0].title).toBe('Hello, how are you?');
    });

    it('should truncate long prompt for topic title', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());
      const longPrompt =
        'This is a very long prompt that exceeds fifty characters and should be truncated for the topic title';

      await caller.execAgent({
        agentId: testAgentId,
        prompt: longPrompt,
      });

      const createdTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.agentId, testAgentId));

      expect(createdTopics).toHaveLength(1);
      expect(createdTopics[0].title).toBe(longPrompt.slice(0, 50) + '...');
    });

    it('should reuse existing topic when topicId is provided', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const [existingTopic] = await serverDB
        .insert(topics)
        .values({ agentId: testAgentId, title: 'Existing Topic', userId })
        .returning();

      const result = await caller.execAgent({
        agentId: testAgentId,
        appContext: { topicId: existingTopic.id },
        prompt: 'Follow up question',
      });

      expect(result.success).toBe(true);

      const allTopics = await serverDB.select().from(topics).where(eq(topics.agentId, testAgentId));
      expect(allTopics).toHaveLength(1);
      expect(allTopics[0].id).toBe(existingTopic.id);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when agent does not exist', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      await expect(
        caller.execAgent({
          agentId: 'non-existent-agent-id',
          prompt: 'Hello',
        }),
      ).rejects.toThrow();
    });
  });

  describe('autoStart behavior', () => {
    it('should have autoStarted=true by default', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.execAgent({
        agentId: testAgentId,
        prompt: 'Hello',
      });

      expect(result.autoStarted).toBe(true);
    });

    it('should respect autoStart=false', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.execAgent({
        agentId: testAgentId,
        autoStart: false,
        prompt: 'Hello',
      });

      expect(result.success).toBe(true);
      expect(result.autoStarted).toBe(false);
    });
  });

  describe('appContext handling', () => {
    it('should include threadId in operation when provided', async () => {
      // First create a topic and thread
      const [topic] = await serverDB
        .insert(topics)
        .values({
          title: 'Test Topic',
          userId,
        })
        .returning();

      const threadResult = (await serverDB
        .insert(threads)
        .values({
          topicId: topic.id,
          type: 'standalone',
          userId,
        })
        .returning()) as { id: string }[];
      const thread = threadResult[0];

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.execAgent({
        agentId: testAgentId,
        appContext: {
          threadId: thread.id,
        },
        prompt: 'Test prompt',
      });

      expect(result.success).toBe(true);
      expect(result.operationId).toBeDefined();
    });
  });

  describe('Full LLM Execution with Local Async Mode', () => {
    it('should execute LLM call using state.modelRuntimeConfig fallback', async () => {
      const responseContent = 'The weather in Hangzhou is sunny today.';
      mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream(responseContent) as any);

      const caller = aiAgentRouter.createCaller(createTestContext());

      // Use autoStart: true (default) to trigger local async execution
      const createResult = await caller.execAgent({
        agentId: testAgentId,
        prompt: 'What is the weather in Hangzhou?',
      });

      expect(createResult.success).toBe(true);
      expect(createResult.operationId).toBeDefined();
      expect(createResult.autoStarted).toBe(true);

      // Wait for async execution to complete
      const finalState = await waitForOperationComplete(
        inMemoryAgentStateManager,
        createResult.operationId,
      );

      expect(finalState.status).toBe('done');
      expect(mockResponsesCreate).toHaveBeenCalled();

      const callArgs = mockResponsesCreate.mock.calls[0][0] as { model: string };
      expect(callArgs.model).toBe('gpt-5-pro');
    });

    it('should save assistant response content to database after execution', async () => {
      const responseContent = 'I am doing great, thank you for asking!';
      mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream(responseContent) as any);

      const caller = aiAgentRouter.createCaller(createTestContext());

      const createResult = await caller.execAgent({
        agentId: testAgentId,
        prompt: 'How are you?',
      });

      // Wait for async execution to complete
      const finalState = await waitForOperationComplete(
        inMemoryAgentStateManager,
        createResult.operationId,
      );

      expect(finalState.status).toBe('done');

      const assistantMessage = finalState.messages.find(
        (m: { role: string }) => m.role === 'assistant',
      );
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage.content).toBe(responseContent);

      const allMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.agentId, testAgentId));

      const dbAssistantMessageWithContent = allMessages.find((m) => m.role === 'assistant');
      expect(dbAssistantMessageWithContent).toBeDefined();
      expect(dbAssistantMessageWithContent?.content).toBe(responseContent);
    });

    it('should verify OpenAI responses.create was called with correct model', async () => {
      const responseContent = 'Test response for model verification';
      mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream(responseContent) as any);

      const caller = aiAgentRouter.createCaller(createTestContext());

      const createResult = await caller.execAgent({
        agentId: testAgentId,
        prompt: 'Test model verification',
      });

      // Wait for async execution to complete
      const finalState = await waitForOperationComplete(
        inMemoryAgentStateManager,
        createResult.operationId,
      );
      expect(finalState.status).toBe('done');

      expect(mockResponsesCreate).toHaveBeenCalled();
      const callArgs = mockResponsesCreate.mock.calls[0][0] as {
        input: unknown[];
        model: string;
      };
      expect(callArgs.model).toBe('gpt-5-pro');
      expect(callArgs.input).toBeDefined();
      expect(Array.isArray(callArgs.input)).toBe(true);
    });

    it('should set correct parentId on assistant message (user message -> assistant message)', async () => {
      const responseContent = 'Response for parentId verification';
      mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream(responseContent) as any);

      const caller = aiAgentRouter.createCaller(createTestContext());

      const createResult = await caller.execAgent({
        agentId: testAgentId,
        prompt: 'Test parentId chain',
      });

      // Wait for async execution to complete
      const finalState = await waitForOperationComplete(
        inMemoryAgentStateManager,
        createResult.operationId,
      );
      expect(finalState.status).toBe('done');

      const allMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.agentId, testAgentId));

      const userMessage = allMessages.find((m) => m.role === 'user');
      const assistantMessage = allMessages.find((m) => m.role === 'assistant');

      expect(userMessage).toBeDefined();
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.parentId).toBe(userMessage?.id);
    });
  });

  describe('Tool Calling Flow with lobe-web-browsing', () => {
    let testAgentWithToolsId: string;

    const createMockResponsesAPIStreamWithTools = () => {
      const responseId = `resp_${Date.now()}`;
      const msgItemId = `msg_${Date.now()}`;
      const toolCallId = `call_${Date.now()}`;

      const chunks = [
        {
          type: 'response.created',
          response: {
            id: responseId,
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            status: 'in_progress',
            model: 'gpt-5-pro',
            output: [],
          },
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: msgItemId,
            type: 'message',
            status: 'in_progress',
            content: [],
            role: 'assistant',
          },
        },
        {
          type: 'response.output_text.delta',
          item_id: msgItemId,
          output_index: 0,
          content_index: 0,
          delta: '让我搜索一下杭州的天气信息。',
        },
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: {
            type: 'function_call',
            call_id: toolCallId,
            name: 'lobe-web-browsing____search____builtin',
            arguments: JSON.stringify({ query: '杭州天气' }),
          },
        },
        {
          type: 'response.completed',
          response: {
            id: responseId,
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            status: 'completed',
            model: 'gpt-5-pro',
            output: [
              {
                id: msgItemId,
                type: 'message',
                status: 'completed',
                content: [{ type: 'output_text', text: '让我搜索一下杭州的天气信息。' }],
                role: 'assistant',
              },
              {
                type: 'function_call',
                call_id: toolCallId,
                name: 'lobe-web-browsing____search____builtin',
                arguments: JSON.stringify({ query: '杭州天气' }),
              },
            ],
            usage: {
              input_tokens: 50,
              output_tokens: 30,
              total_tokens: 80,
            },
          },
        },
      ];

      return createMockResponsesStream(chunks);
    };

    const createMockFinalResponseStream = () => {
      const responseId = `resp_final_${Date.now()}`;
      const msgItemId = `msg_final_${Date.now()}`;
      const finalContent = '根据搜索结果，杭州今天天气晴朗，气温约15-22°C，适合外出活动。';

      const chunks = [
        {
          type: 'response.created',
          response: {
            id: responseId,
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            status: 'in_progress',
            model: 'gpt-5-pro',
            output: [],
          },
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: msgItemId,
            type: 'message',
            status: 'in_progress',
            content: [],
            role: 'assistant',
          },
        },
        {
          type: 'response.output_text.delta',
          item_id: msgItemId,
          output_index: 0,
          content_index: 0,
          delta: finalContent,
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            id: msgItemId,
            type: 'message',
            status: 'completed',
            content: [{ type: 'output_text', text: finalContent }],
            role: 'assistant',
          },
        },
        {
          type: 'response.completed',
          response: {
            id: responseId,
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            status: 'completed',
            model: 'gpt-5-pro',
            output: [
              {
                id: msgItemId,
                type: 'message',
                status: 'completed',
                content: [{ type: 'output_text', text: finalContent }],
                role: 'assistant',
              },
            ],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              total_tokens: 150,
            },
          },
        },
      ];

      return createMockResponsesStream(chunks);
    };

    beforeEach(async () => {
      const [agentWithTools] = await serverDB
        .insert(agents)
        .values({
          chatConfig: { autoCreateTopicThreshold: 2, searchMode: 'auto' },
          model: 'gpt-5-pro',
          plugins: [],
          provider: 'openai',
          systemRole: 'You are a helpful assistant that can search the web.',
          title: 'Test Assistant with Web Browsing',
          userId,
        })
        .returning();
      testAgentWithToolsId = agentWithTools.id;
    });

    it('should execute tool call flow: LLM -> search tool -> LLM -> finish', async () => {
      let callCount = 0;
      mockResponsesCreate.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(createMockResponsesAPIStreamWithTools() as any);
        }
        return Promise.resolve(createMockFinalResponseStream() as any);
      });

      const mockExecuteTool = vi.spyOn(ToolExecutionService.prototype, 'executeTool');
      mockExecuteTool.mockResolvedValue({
        content: JSON.stringify({
          results: [
            {
              title: '杭州天气预报',
              snippet: '杭州今天天气晴，气温15-22°C',
              url: 'https://weather.com/hangzhou',
            },
          ],
        }),
        error: null,
        executionTime: 500,
        state: {},
        success: true,
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const createResult = await caller.execAgent({
        agentId: testAgentWithToolsId,
        prompt: '杭州天气如何',
      });

      expect(createResult.success).toBe(true);
      expect(createResult.operationId).toBeDefined();

      // Wait for async execution to complete
      const finalState = await waitForOperationComplete(
        inMemoryAgentStateManager,
        createResult.operationId,
      );

      expect(finalState.status).toBe('done');

      expect(mockResponsesCreate).toHaveBeenCalled();
      const firstCallArgs = mockResponsesCreate.mock.calls[0][0] as {
        tools: Array<{ function?: { name: string }; name?: string }>;
      };
      expect(firstCallArgs.tools).toBeDefined();
      expect(firstCallArgs.tools.length).toBeGreaterThan(0);

      const toolNames = firstCallArgs.tools.map((t) => t.name || t.function?.name);
      const hasWebBrowsingTools = toolNames.some((name) => name?.includes('lobe-web-browsing'));
      expect(hasWebBrowsingTools).toBe(true);

      const allMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.agentId, testAgentWithToolsId));

      expect(allMessages.length).toEqual(4);

      const userMessage = allMessages.find((m) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.content).toBe('杭州天气如何');

      const assistantMessages = allMessages.filter((m) => m.role === 'assistant');
      expect(assistantMessages.length).toBe(2);

      const toolMessage = allMessages.find((m) => m.role === 'tool');
      expect(toolMessage).toBeDefined();

      expect(mockExecuteTool).toHaveBeenCalled();
      const toolCallArgs = mockExecuteTool.mock.calls[0][0];
      expect(toolCallArgs.identifier).toBe('lobe-web-browsing');
      expect(toolCallArgs.apiName).toBe('search');

      mockExecuteTool.mockRestore();
    });

    it('should create correct parentId chain: user -> assistant1 -> tool -> assistant2', async () => {
      let callCount = 0;
      mockResponsesCreate.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(createMockResponsesAPIStreamWithTools() as any);
        }
        return Promise.resolve(createMockFinalResponseStream() as any);
      });

      const mockExecuteTool = vi.spyOn(ToolExecutionService.prototype, 'executeTool');
      mockExecuteTool.mockResolvedValue({
        content: 'Search results for Hangzhou weather',
        error: null,
        executionTime: 100,
        state: {},
        success: true,
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const createResult = await caller.execAgent({
        agentId: testAgentWithToolsId,
        prompt: '杭州天气如何',
      });

      // Wait for async execution to complete
      const finalState = await waitForOperationComplete(
        inMemoryAgentStateManager,
        createResult.operationId,
      );

      expect(finalState.status).toBe('done');

      const allMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.agentId, testAgentWithToolsId));

      expect(allMessages.length).toBe(4);

      const userMessage = allMessages.find((m) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.parentId).toBeNull();

      const firstAssistant = allMessages.find(
        (m) => m.role === 'assistant' && m.parentId === userMessage?.id,
      );
      expect(firstAssistant).toBeDefined();

      const toolMessage = allMessages.find((m) => m.role === 'tool');
      expect(toolMessage).toBeDefined();
      expect(toolMessage?.parentId).toBe(firstAssistant?.id);

      const secondAssistant = allMessages.find(
        (m) => m.role === 'assistant' && m.parentId === toolMessage?.id,
      );
      expect(secondAssistant).toBeDefined();

      mockExecuteTool.mockRestore();
    });
  });
});
