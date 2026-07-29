// @vitest-environment node
/**
 * Integration test for the server `lobe-agent-management.callAgent` deferred
 * execution flow.
 *
 * Verifies the full lifecycle end-to-end on the in-memory runtime:
 *   1. Parent op LLM emits a `lobe-agent-management____callAgent` tool call.
 *   2. The real server executor parks the parent, creates a pending tool
 *      placeholder, and forks the target agent as a child op.
 *   3. The child op completes.
 *   4. The completion bridge backfills the placeholder and resumes the parent.
 *   5. The parent reaches `done`.
 */
import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, agents, messagePlugins, messages } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
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
let parentAgentId: string;
let targetAgentId: string;

const TARGET_ANSWER = 'The target agent completed the delegated callAgent work.';
const PARENT_FINAL = 'I received the target agent result and the delegated work is complete.';

const createTestContext = () => ({ jwtPayload: { userId }, userId });

const createCallAgentResponse = () => {
  const responseId = `resp_call_agent_${Date.now()}`;
  const msgItemId = `msg_call_agent_${Date.now()}`;
  const callId = 'call_agent_1';
  const fnCall = {
    arguments: JSON.stringify({
      agentId: targetAgentId,
      instruction: 'Handle the delegated backend integration task.',
      runAsTask: true,
      taskTitle: 'Delegated backend integration task',
      timeout: 30_000,
    }),
    call_id: callId,
    name: 'lobe-agent-management____callAgent',
    type: 'function_call',
  };

  return createMockResponsesStream([
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
      delta: 'I will delegate this to the target agent.',
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
            content: [{ text: 'I will delegate this to the target agent.', type: 'output_text' }],
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
  ]);
};

const createFinalTextResponse = (content: string) => {
  const responseId = `resp_final_${Date.now()}_${content.length}`;
  const msgItemId = `msg_final_${Date.now()}_${content.length}`;

  return createMockResponsesStream([
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
  ]);
};

beforeEach(async () => {
  serverDB = await getTestDB();
  testDB = serverDB;
  userId = await createTestUser(serverDB);

  const insertedAgents = await serverDB
    .insert(agents)
    .values([
      {
        chatConfig: {},
        model: 'gpt-5-pro',
        plugins: ['lobe-agent-management'],
        provider: 'openai',
        systemRole: 'You are a supervisor that delegates work to other agents.',
        title: 'callAgent Supervisor',
        userId,
      },
      {
        chatConfig: {},
        model: 'gpt-5-pro',
        plugins: [],
        provider: 'openai',
        systemRole: 'You are the target agent. Return a concise result.',
        title: 'callAgent Target',
        userId,
      },
    ])
    .returning();

  parentAgentId = insertedAgents[0].id;
  targetAgentId = insertedAgents[1].id;

  // `create` is overloaded (streaming / non-streaming); its precise spy type
  // isn't assignable to the generic MockInstance fallback, so widen via unknown.
  mockResponsesCreate = vi.spyOn(
    OpenAI.Responses.prototype,
    'create',
  ) as unknown as typeof mockResponsesCreate;
});

afterEach(async () => {
  await cleanupTestUser(serverDB, userId);
  vi.clearAllMocks();
  vi.restoreAllMocks();
  inMemoryAgentStateManager.clear();
  inMemoryStreamEventManager.clear();
});

describe('Server callAgent deferred execution', () => {
  it('parks the parent, runs the target agent, backfills the tool message and resumes', async () => {
    let callCount = 0;
    mockResponsesCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(createCallAgentResponse() as any);
      if (callCount === 2) return Promise.resolve(createFinalTextResponse(TARGET_ANSWER) as any);
      return Promise.resolve(createFinalTextResponse(PARENT_FINAL) as any);
    });

    const caller = aiAgentRouter.createCaller(createTestContext());

    const createResult = await caller.execAgent({
      agentId: parentAgentId,
      prompt: 'Delegate this work to the target agent and report back.',
      userInterventionConfig: { approvalMode: 'headless' },
    });
    expect(createResult.success).toBe(true);

    const finalState = await waitForOperationComplete(
      inMemoryAgentStateManager,
      createResult.operationId,
      { maxWaitTime: 20_000 },
    );

    expect(finalState.status).toBe('done');
    expect(finalState.pendingToolsCalling ?? []).toHaveLength(0);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(3);

    const childOps = await serverDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.parentOperationId, createResult.operationId));
    expect(childOps).toHaveLength(1);
    expect(childOps[0]).toMatchObject({
      agentId: targetAgentId,
      status: 'done',
    });

    const toolMessages = await serverDB
      .select({
        content: messages.content,
        role: messages.role,
        state: messagePlugins.state,
        identifier: messagePlugins.identifier,
        apiName: messagePlugins.apiName,
        toolCallId: messagePlugins.toolCallId,
      })
      .from(messages)
      .innerJoin(messagePlugins, eq(messagePlugins.id, messages.id))
      .where(
        and(
          eq(messages.userId, userId),
          eq(messagePlugins.identifier, 'lobe-agent-management'),
          eq(messagePlugins.apiName, 'callAgent'),
        ),
      );

    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]).toMatchObject({
      apiName: 'callAgent',
      content: TARGET_ANSWER,
      identifier: 'lobe-agent-management',
      role: 'tool',
      toolCallId: 'call_agent_1',
    });
    expect(toolMessages[0].state).toMatchObject({
      status: 'completed',
      threadId: childOps[0].threadId,
    });
  }, 30_000);
});
