// @vitest-environment node
/**
 * Integration tests for multi-round tool execution
 * Tests for LOBE-1657 fix: tool messages should not be duplicated across rounds
 *
 * Note: AgentStateManager and StreamEventManager will automatically use
 * InMemory implementations when Redis is not available (test environment).
 */
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, messages } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inMemoryAgentStateManager } from '@/server/modules/AgentRuntime/InMemoryAgentStateManager';
import { inMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';
import { ToolExecutionService } from '@/server/services/toolExecution';

import { aiAgentRouter } from '../../../aiAgent';
import { cleanupTestUser, createTestUser } from '../setup';
import { createMockResponsesStream, waitForOperationComplete } from './helpers';

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
let testAgentWithToolsId: string;

const createTestContext = () => ({
  jwtPayload: { userId },
  userId,
});

// Helper to create mock streaming response with multiple tool calls
const createMockResponseWithMultipleTools = (roundNum: number) => {
  const responseId = `resp_round${roundNum}_${Date.now()}`;
  const msgItemId = `msg_round${roundNum}_${Date.now()}`;
  const toolCallId1 = `call_search_round${roundNum}`;
  const toolCallId2 = `call_crawl_round${roundNum}`;

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
      delta: `Round ${roundNum}: Let me search and crawl for you.`,
    },
    {
      type: 'response.output_item.added',
      output_index: 1,
      item: {
        type: 'function_call',
        call_id: toolCallId1,
        name: 'lobe-web-browsing____search____builtin',
        arguments: JSON.stringify({ query: `query_round${roundNum}` }),
      },
    },
    {
      type: 'response.output_item.added',
      output_index: 2,
      item: {
        type: 'function_call',
        call_id: toolCallId2,
        name: 'lobe-web-browsing____crawl____builtin',
        arguments: JSON.stringify({ url: `https://example.com/page${roundNum}` }),
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
            content: [
              {
                type: 'output_text',
                text: `Round ${roundNum}: Let me search and crawl for you.`,
              },
            ],
            role: 'assistant',
          },
          {
            type: 'function_call',
            call_id: toolCallId1,
            name: 'lobe-web-browsing____search____builtin',
            arguments: JSON.stringify({ query: `query_round${roundNum}` }),
          },
          {
            type: 'function_call',
            call_id: toolCallId2,
            name: 'lobe-web-browsing____crawl____builtin',
            arguments: JSON.stringify({ url: `https://example.com/page${roundNum}` }),
          },
        ],
        usage: {
          input_tokens: 50 * roundNum,
          output_tokens: 30,
          total_tokens: 50 * roundNum + 30,
        },
      },
    },
  ];

  return createMockResponsesStream(chunks);
};

// Helper to create final response (no tools)
const createMockFinalResponse = () => {
  const responseId = `resp_final_${Date.now()}`;
  const msgItemId = `msg_final_${Date.now()}`;
  const finalContent = 'Based on my research across multiple rounds, here is the final answer.';

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
      type: 'response.output_text.delta',
      item_id: msgItemId,
      output_index: 0,
      content_index: 0,
      delta: finalContent,
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
          input_tokens: 200,
          output_tokens: 50,
          total_tokens: 250,
        },
      },
    },
  ];

  return createMockResponsesStream(chunks);
};

beforeEach(async () => {
  // Setup test database
  serverDB = await getTestDB();
  testDB = serverDB;
  userId = await createTestUser(serverDB);

  // Create test agent with search enabled via chatConfig.searchMode
  const [agentWithTools] = await serverDB
    .insert(agents)
    .values({
      chatConfig: { autoCreateTopicThreshold: 2, searchMode: 'auto' },
      model: 'gpt-5-pro',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant that can search and crawl the web.',
      title: 'Test Assistant for Multi-Round Tools',
      userId,
    })
    .returning();
  testAgentWithToolsId = agentWithTools.id;

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

describe('Multi-Round Tool Execution', () => {
  /**
   * This test verifies the fix for LOBE-1657:
   * When executing multiple rounds of batch tool calls, tool messages should not be duplicated.
   *
   * Scenario: LLM returns multiple tool calls in each round
   * - Round 1: LLM -> 2 tools (search + crawl) -> tool results
   * - Round 2: LLM -> 2 tools (search + crawl) -> tool results
   * - Round 3: LLM -> final response
   *
   * Expected: 4 tool messages total (2 from round 1 + 2 from round 2), no duplicates
   */
  it('should not duplicate tool messages across multiple LLM rounds with batch tool execution', async () => {
    let callCount = 0;
    mockResponsesCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(createMockResponseWithMultipleTools(1) as any);
      } else if (callCount === 2) {
        return Promise.resolve(createMockResponseWithMultipleTools(2) as any);
      }
      return Promise.resolve(createMockFinalResponse() as any);
    });

    const mockExecuteTool = vi.spyOn(ToolExecutionService.prototype, 'executeTool');
    mockExecuteTool.mockImplementation(async (toolCall) => {
      const isSearch = toolCall.apiName === 'search';
      return {
        content: JSON.stringify({
          result: isSearch ? 'Search results' : 'Crawled content',
          tool: toolCall.apiName,
          id: toolCall.id,
        }),
        error: null,
        executionTime: 100,
        state: {},
        success: true,
      };
    });

    const caller = aiAgentRouter.createCaller(createTestContext());

    const createResult = await caller.execAgent({
      agentId: testAgentWithToolsId,
      prompt: 'Please search and crawl multiple pages for comprehensive research',
    });

    expect(createResult.success).toBe(true);

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

    const toolMessages = allMessages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(4);

    const toolCallIdsFromContent = toolMessages
      .map((m) => {
        try {
          const parsed = JSON.parse(m.content || '{}');
          return parsed.id;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const uniqueToolCallIds = [...new Set(toolCallIdsFromContent)];
    expect(toolCallIdsFromContent.length).toBe(uniqueToolCallIds.length);

    expect(toolCallIdsFromContent.sort()).toEqual([
      'call_crawl_round1',
      'call_crawl_round2',
      'call_search_round1',
      'call_search_round2',
    ]);

    expect(allMessages).toHaveLength(8);

    const assistantMessages = allMessages.filter((m) => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(3);

    expect(mockResponsesCreate).toHaveBeenCalledTimes(3);

    mockExecuteTool.mockRestore();
  });

  it('should maintain correct state.messages count in AgentState across tool rounds', async () => {
    let callCount = 0;
    mockResponsesCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(createMockResponseWithMultipleTools(1) as any);
      } else if (callCount === 2) {
        return Promise.resolve(createMockResponseWithMultipleTools(2) as any);
      }
      return Promise.resolve(createMockFinalResponse() as any);
    });

    const mockExecuteTool = vi.spyOn(ToolExecutionService.prototype, 'executeTool');
    mockExecuteTool.mockResolvedValue({
      content: JSON.stringify({ result: 'Tool executed' }),
      error: null,
      executionTime: 100,
      state: {},
      success: true,
    });

    const caller = aiAgentRouter.createCaller(createTestContext());

    const createResult = await caller.execAgent({
      agentId: testAgentWithToolsId,
      prompt: 'Multi-round tool test',
    });

    // Wait for async execution to complete
    const finalState = await waitForOperationComplete(
      inMemoryAgentStateManager,
      createResult.operationId,
    );

    expect(finalState.status).toBe('done');

    const stateToolMessages = finalState.messages.filter(
      (m: { role: string }) => m.role === 'tool',
    );
    expect(stateToolMessages).toHaveLength(4);

    const stateToolCallIds = stateToolMessages.map((m: { tool_call_id: string }) => m.tool_call_id);
    expect(new Set(stateToolCallIds).size).toBe(4);

    mockExecuteTool.mockRestore();
  });
});
