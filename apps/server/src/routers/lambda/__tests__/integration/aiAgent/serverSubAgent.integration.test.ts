// @vitest-environment node
/**
 * Integration test for the server `callSubAgent` async suspend/resume flow.
 *
 * Verifies the full deferred-tool lifecycle end-to-end on the in-memory runtime:
 *   1. Parent activates `lobe-agent` (loaded on demand), then emits a
 *      `lobe-agent____callSubAgent` tool call.
 *   2. The real server executor parks the parent (`waiting_for_async_tool`),
 *      creates a pending placeholder tool message, and forks a child op.
 *   3. The child op runs independently and completes.
 *   4. The completion bridge backfills the placeholder tool message with the
 *      sub-agent's answer and resumes the parent.
 *   5. The parent op runs one more LLM step and reaches `done`.
 */
import { LobeAgentIdentifier, stripSubAgentReference } from '@lobechat/builtin-tool-lobe-agent';
import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, agents, messages } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { inMemoryAgentStateManager } from '@/server/modules/AgentRuntime/InMemoryAgentStateManager';
import { inMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';

import { aiAgentRouter } from '../../../aiAgent';
import { cleanupTestUser, createTestUser } from '../setup';
import { createMockResponsesStream, waitForOperationComplete } from './helpers';

process.env.OPENAI_API_KEY = 'sk-test-fake-api-key-for-testing';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      getFullFileUrl: vi.fn().mockImplementation(function (path: string) {
        return path ? `/files${path}` : null;
      }),
    };
  }),
}));

let mockResponsesCreate: any;
let serverDB: LobeChatDatabase;
let userId: string;
let testAgentId: string;

const SUB_AGENT_ANSWER = 'The sub-agent researched the topic and found the answer is 42.';
const PARENT_FINAL = 'Based on the sub-agent result, the final answer is 42.';

const createTestContext = () => ({ jwtPayload: { userId }, userId });

/** Mock a parent step that emits a single tool call. */
const createToolCallResponse = (callId: string, name: string, args: Record<string, unknown>) => {
  const responseId = `resp_${callId}_${Date.now()}`;
  const msgItemId = `msg_${callId}_${Date.now()}`;
  const fnCall = {
    arguments: JSON.stringify(args),
    call_id: callId,
    name,
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
      // The scripted first response delegates immediately, before any activation step.
      plugins: [LobeAgentIdentifier],
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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  inMemoryAgentStateManager.clear();
  inMemoryStreamEventManager.clear();
});

describe('Server callSubAgent suspend/resume', () => {
  it.each([
    { decision: undefined, reason: undefined },
    { decision: 'allow', reason: undefined },
    { decision: 'deny', reason: undefined },
    { decision: 'deny', reason: '' },
  ] as const)(
    'publishes the child result after $decision control with reason=$reason and resumes the parent',
    async ({ decision, reason }) => {
      const pendingContents: (string | null)[] = [];
      const reviewedResults: string[] = [];
      const fetchHook = vi.fn(async (_url: string, init: RequestInit) => {
        const payload = JSON.parse(init.body as string);
        // The hook reviews every tool result; only the sub-agent result is under test,
        // so the activation that precedes it passes untouched.
        if (payload.apiName !== 'callSubAgent') return new Response(JSON.stringify({}));
        const [placeholder] = await serverDB
          .select()
          .from(messages)
          .where(eq(messages.id, payload.toolMessageId));
        pendingContents.push(placeholder.content);
        reviewedResults.push(payload.result.content);
        return new Response(JSON.stringify({ decision, reason }));
      });
      if (decision) {
        vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', 'https://hooks.example/subagent-result');
        vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-test-token');
        vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'afterToolCall');
        vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
        const originalFetch = globalThis.fetch;
        vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
          String(url) === 'https://hooks.example/subagent-result'
            ? fetchHook(url, init)
            : originalFetch(url, init),
        );
      }
      // 1: parent activates lobe-agent  2: parent emits callSubAgent
      // 3: sub-op final answer  4: parent resume final
      mockResponsesCreate
        .mockResolvedValueOnce(
          createToolCallResponse('activate_1', 'lobe-activator____activateTools', {
            identifiers: [LobeAgentIdentifier],
            reason: 'Delegate the research to a sub-agent.',
          }) as any,
        )
        .mockResolvedValueOnce(
          createToolCallResponse('call_subagent_1', 'lobe-agent____callSubAgent', {
            description: 'Research the answer',
            instruction: 'Find the answer to the ultimate question.',
          }) as any,
        )
        .mockResolvedValueOnce(createFinalTextResponse(SUB_AGENT_ANSWER) as any)
        .mockResolvedValueOnce(createFinalTextResponse(PARENT_FINAL) as any)
        .mockRejectedValue(new Error('Unexpected extra model call'));

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

      // lobe-agent loads on demand: absent from the first step, offered once activated
      const callSubAgentTool = expect.objectContaining({
        name: 'lobe-agent____callSubAgent',
        type: 'function',
      });
      expect(mockResponsesCreate.mock.calls[0][0].tools).not.toContainEqual(callSubAgentTool);
      expect(mockResponsesCreate.mock.calls[1][0].tools).toContainEqual(callSubAgentTool);

      // Four LLM calls: parent-activate, parent-delegate, sub-op, parent-resume
      expect(mockResponsesCreate).toHaveBeenCalledTimes(4);

      // A child op was spawned and reconciled to the parent
      const childOps = await serverDB
        .select()
        .from(agentOperations)
        .where(eq(agentOperations.parentOperationId, createResult.operationId));
      expect(childOps.length).toBeGreaterThanOrEqual(1);
      if (decision) {
        expect(pendingContents).toEqual(['']);
        expect(reviewedResults[0]).toContain(SUB_AGENT_ANSWER);
        expect(reviewedResults[0]).toMatch(/<sub_agent id="[^"]+" \/>$/);
      }

      // The placeholder tool message was backfilled with the sub-agent's answer,
      // followed by the hidden reference the parent uses to continue that sub-agent
      const allMessages = await serverDB.select().from(messages).where(eq(messages.userId, userId));
      const subAgentToolMessage = allMessages.find(
        (m) =>
          m.role === 'tool' &&
          !!m.content &&
          stripSubAgentReference(m.content) ===
            (decision === 'deny' ? 'Blocked by afterToolCall hook.' : SUB_AGENT_ANSWER),
      );
      expect(subAgentToolMessage).toBeDefined();
      if (decision !== 'deny')
        expect(subAgentToolMessage!.content).toMatch(/<sub_agent id="[^"]+" \/>$/);
      const parentInput = JSON.stringify(mockResponsesCreate.mock.calls[3][0]);
      expect(parentInput).toContain(
        decision === 'deny' ? 'Blocked by afterToolCall hook.' : SUB_AGENT_ANSWER,
      );
      if (decision === 'deny') {
        expect(parentInput).not.toContain(SUB_AGENT_ANSWER);
        // A replay after removal of the environment hook must not replace the first final result.
        vi.unstubAllEnvs();
        const messageModel = new MessageModel(serverDB, userId);
        const replay = await messageModel.updateToolMessage(subAgentToolMessage!.id, {
          content: SUB_AGENT_ANSWER,
          pluginState: { status: 'completed' },
          pluginError: null,
          onlyIfEmpty: true,
        });
        expect(replay).toMatchObject({ success: true, applied: false });
        const persisted = await messageModel.findById(subAgentToolMessage!.id);
        expect(persisted?.content).toBe('Blocked by afterToolCall hook.');
        expect(JSON.stringify(persisted)).not.toContain(SUB_AGENT_ANSWER);
      }
    },
    30_000,
  );
});
