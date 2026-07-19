// @vitest-environment node
/**
 * Integration test for the server `callSubAgent` async suspend/resume flow.
 *
 * Verifies the full deferred-tool lifecycle end-to-end on the in-memory runtime:
 *   1. Parent op LLM emits a `lobe-agent____callSubAgent` tool call.
 *   2. The real server executor parks the parent (`waiting_for_async_tool`),
 *      creates a pending placeholder tool message, and forks a child op.
 *   3. The child op runs independently and completes.
 *   4. The completion bridge backfills the placeholder tool message with the
 *      sub-agent's answer and resumes the parent.
 *   5. The parent op runs one more LLM step and reaches `done`.
 */
import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, agents, messages } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inMemoryAgentStateManager } from '@/server/modules/AgentRuntime/InMemoryAgentStateManager';
import { inMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';

import { aiAgentRouter } from '../../../aiAgent';
import { cleanupTestUser, createTestUser } from '../setup';
import { createMockResponsesStream, waitForOperationComplete } from './helpers';

process.env.OPENAI_API_KEY = 'sk-test-fake-api-key-for-testing';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockImplementation((path: string) => (path ? `/files${path}` : null)),
  })),
}));

let mockResponsesCreate: any;
let serverDB: LobeChatDatabase;
let userId: string;
let testAgentId: string;

const SUB_AGENT_ANSWER = 'The sub-agent researched the topic and found the answer is 42.';
const PARENT_FINAL = 'Based on the sub-agent result, the final answer is 42.';

const createTestContext = () => ({ jwtPayload: { userId }, userId });

/** Mock parent first step: a single `callSubAgent` tool call. */
const createCallSubAgentResponse = () => {
  const responseId = `resp_parent_${Date.now()}`;
  const msgItemId = `msg_parent_${Date.now()}`;
  const callId = `call_subagent_1`;
  const fnCall = {
    arguments: JSON.stringify({
      description: 'Research the answer',
      instruction: 'Find the answer to the ultimate question.',
    }),
    call_id: callId,
    name: 'lobe-agent____callSubAgent',
    type: 'function_call',
  };

  const chunks = [
    {
      response: {
        created_at: Math.floor(Date.now() / 1000),
        id: responseId,
        model: 'gpt-5-pro',
        object: 'response',
        output: [],
        status: 'in_progress',
      },
      type: 'response.created',
    },
    {
      item: {
        content: [],
        id: msgItemId,
        role: 'assistant',
        status: 'in_progress',
        type: 'message',
      },
      output_index: 0,
      type: 'response.output_item.added',
    },
    {
      content_index: 0,
      delta: 'Let me delegate this to a sub-agent.',
      item_id: msgItemId,
      output_index: 0,
      type: 'response.output_text.delta',
    },
    { item: fnCall, output_index: 1, type: 'response.output_item.added' },
    {
      response: {
        created_at: Math.floor(Date.now() / 1000),
        id: responseId,
        model: 'gpt-5-pro',
        object: 'response',
        output: [
          {
            content: [{ text: 'Let me delegate this to a sub-agent.', type: 'output_text' }],
            id: msgItemId,
            role: 'assistant',
            status: 'completed',
            type: 'message',
          },
          fnCall,
        ],
        status: 'completed',
        usage: { input_tokens: 30, output_tokens: 20, total_tokens: 50 },
      },
      type: 'response.completed',
    },
  ];

  return createMockResponsesStream(chunks);
};

/** Mock a plain final text response (no tool calls). */
const createFinalTextResponse = (content: string) => {
  const responseId = `resp_final_${Date.now()}_${Math.round(content.length)}`;
  const msgItemId = `msg_final_${Date.now()}_${Math.round(content.length)}`;

  const chunks = [
    {
      response: {
        created_at: Math.floor(Date.now() / 1000),
        id: responseId,
        model: 'gpt-5-pro',
        object: 'response',
        output: [],
        status: 'in_progress',
      },
      type: 'response.created',
    },
    {
      content_index: 0,
      delta: content,
      item_id: msgItemId,
      output_index: 0,
      type: 'response.output_text.delta',
    },
    {
      response: {
        created_at: Math.floor(Date.now() / 1000),
        id: responseId,
        model: 'gpt-5-pro',
        object: 'response',
        output: [
          {
            content: [{ text: content, type: 'output_text' }],
            id: msgItemId,
            role: 'assistant',
            status: 'completed',
            type: 'message',
          },
        ],
        status: 'completed',
        usage: { input_tokens: 40, output_tokens: 20, total_tokens: 60 },
      },
      type: 'response.completed',
    },
  ];

  return createMockResponsesStream(chunks);
};

beforeEach(async () => {
  serverDB = await getTestDB();
  testDB = serverDB;
  userId = await createTestUser(serverDB);

  const [agent] = await serverDB
    .insert(agents)
    .values({
      agencyConfig: {
        subagent: { model: 'gpt-5-pro', provider: 'openai' },
      },
      chatConfig: {},
      model: 'gpt-5-pro',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a supervisor that can delegate work to sub-agents.',
      title: 'Supervisor',
      userId,
    })
    .returning();
  testAgentId = agent.id;

  mockResponsesCreate = vi.spyOn(OpenAI.Responses.prototype, 'create');
});

afterEach(async () => {
  await cleanupTestUser(serverDB, userId);
  vi.clearAllMocks();
  vi.restoreAllMocks();
  inMemoryAgentStateManager.clear();
  inMemoryStreamEventManager.clear();
});

describe('Server callSubAgent suspend/resume', () => {
  it('parks the parent, runs the sub-op, backfills the tool message and resumes', async () => {
    // 1: parent emits callSubAgent  2: sub-op final answer  3: parent resume final
    let callCount = 0;
    mockResponsesCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(createCallSubAgentResponse() as any);
      if (callCount === 2) return Promise.resolve(createFinalTextResponse(SUB_AGENT_ANSWER) as any);
      return Promise.resolve(createFinalTextResponse(PARENT_FINAL) as any);
    });

    const caller = aiAgentRouter.createCaller(createTestContext());

    const createResult = await caller.execAgent({
      agentId: testAgentId,
      prompt: 'Please research the ultimate question and report back.',
    });
    expect(createResult.success).toBe(true);

    const finalState = await waitForOperationComplete(
      inMemoryAgentStateManager,
      createResult.operationId,
      { maxWaitTime: 20_000 },
    );

    // Parent resumed and completed
    expect(finalState.status).toBe('done');
    expect(finalState.pendingToolsCalling ?? []).toHaveLength(0);

    // Three LLM calls: parent-initial, sub-op, parent-resume
    expect(mockResponsesCreate).toHaveBeenCalledTimes(3);

    // A child op was spawned and reconciled to the parent
    const childOps = await serverDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.parentOperationId, createResult.operationId));
    expect(childOps.length).toBeGreaterThanOrEqual(1);

    // The placeholder tool message was backfilled with the sub-agent's answer
    const allMessages = await serverDB.select().from(messages).where(eq(messages.userId, userId));
    const subAgentToolMessage = allMessages.find(
      (m) => m.role === 'tool' && m.content === SUB_AGENT_ANSWER,
    );
    expect(subAgentToolMessage).toBeDefined();
  });
});
