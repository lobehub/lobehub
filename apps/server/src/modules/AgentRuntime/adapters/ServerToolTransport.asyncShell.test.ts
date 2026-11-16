import type { AgentRuntimeHost, AgentState } from '@lobechat/agent-runtime';
import {
  AgentRuntime,
  createAgentRuntimeExecutors,
  GeneralChatAgent,
} from '@lobechat/agent-runtime';
import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import type { ChatToolPayload } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HookDispatcher } from '@/server/services/agentRuntime/hooks';

import type { RuntimeExecutorContext } from '../context';
import { ServerToolTransport } from './ServerToolTransport';

const { dispatchClient, isInterrupted, parkAsyncShell } = vi.hoisted(() => ({
  dispatchClient: vi.fn(),
  isInterrupted: vi.fn(),
  parkAsyncShell: vi.fn(),
}));
vi.mock('../dispatchClientTool', () => ({ dispatchClientTool: dispatchClient }));
vi.mock('../asyncShellPark', () => ({ parkAsyncShell }));
vi.mock('@/database/models/user', () => ({ UserModel: { getEmailsByIds: async () => [] } }));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: () => false }));
vi.mock('@/libs/qstash', () => ({ OtelQstashClient: class {} }));
vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getAgentVisibility = async () => 'private';
  },
}));
vi.mock('../executorHelpers', () => ({
  archiveRuntimeToolResult: async (result: unknown) => result,
  buildServerAgentMemberRunner: () => undefined,
  buildServerVirtualSubAgentRunner: () => undefined,
  GEN_AI_FUNCTION_TOOL_TYPE: 'function',
  isOperationInterrupted: isInterrupted,
  log: () => {},
  registerWorkFromIntent: vi.fn(),
  TOOL_MAX_RETRIES: 2,
  TOOL_PRICING: {},
}));

const runCommandCall: ChatToolPayload = {
  apiName: 'runCommand',
  arguments: '{"command":"sleep 600"}',
  executor: 'server',
  id: 'call-shell',
  identifier: LocalSystemIdentifier,
  type: 'builtin',
};

const stillRunning = {
  content: 'Command is still running after the wait window.\nshell_id: sh-1',
  state: { commandId: 'sh-1', completionWatch: true, running: true, success: true },
  success: true,
};

function setup() {
  const execute = vi.fn().mockResolvedValue(stillRunning);
  const rows: Record<string, unknown>[] = [];
  const state = {
    cost: {
      calculatedAt: '',
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt: '',
    lastModified: '',
    messages: [],
    operationId: 'op',
    origin: { agentId: 'agent', topicId: 'topic' },
    status: 'running',
    stepCount: 0,
    usage: {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
      tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    },
    userInterventionConfig: { approvalMode: 'auto-run' },
  } as AgentState;
  const transport = new ServerToolTransport({
    hookDispatcher: new HookDispatcher(),
    operationId: 'op',
    serverDB: {},
    stepIndex: 1,
    streamManager: { sendToolExecute: vi.fn() },
    toolExecutionService: { executeTool: execute },
    userId: 'user',
  } as unknown as RuntimeExecutorContext);
  const host: AgentRuntimeHost = {
    operation: { agentId: 'agent', operationId: 'op', stepIndex: 1 },
    transports: {
      messages: {
        createToolMessage: vi.fn(async (row) => {
          rows.push(row);
          return { ...row, id: `row-${rows.length}` };
        }),
        findToolMessageIdByToolCallId: vi.fn(),
        query: vi.fn(async () => rows),
        update: vi.fn(),
        updateToolIntervention: vi.fn(),
        updateToolMessage: vi.fn(),
      } as unknown as AgentRuntimeHost['transports']['messages'],
      stream: { publishChunk: vi.fn(), publishEvent: vi.fn() },
      tools: transport,
    },
  };
  const runtime = new AgentRuntime(new GeneralChatAgent({ operationId: 'op' }), {
    executors: createAgentRuntimeExecutors(host),
  });
  const step = () =>
    runtime.step(state, {
      payload: {
        hasToolsCalling: true,
        parentMessageId: 'assistant',
        toolsCalling: [runCommandCall],
      },
      phase: 'llm_result',
    });
  return { execute, rows, step };
}

beforeEach(() => {
  isInterrupted.mockReset().mockResolvedValue(false);
  dispatchClient.mockReset();
  parkAsyncShell.mockReset().mockResolvedValue(null);
});

describe('async shell on the device-gateway path', () => {
  // Desktop and `lh connect` commands in a server run go through the
  // local-system server runtime (device gateway), never the client dispatch.
  // The park used to hang off the client branch only, so it never ran.
  it('offers a server-runtime runCommand result to the park', async () => {
    const fixture = setup();
    parkAsyncShell.mockResolvedValue({
      attempts: 1,
      result: {
        content: '',
        deferred: true,
        state: { commandId: 'sh-1', toolMessageId: 'placeholder' },
        success: true,
      },
    });

    const result = await fixture.step();

    expect(dispatchClient).not.toHaveBeenCalled();
    expect(parkAsyncShell).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ parentMessageId: 'assistant', toolCall: runCommandCall }),
      expect.objectContaining({ state: expect.objectContaining({ completionWatch: true }) }),
    );
    expect(result.newState.status).toBe('waiting_for_async_tool');
    // The parked call writes no tool row now: the completion fills the placeholder.
    expect(fixture.rows).toHaveLength(0);
  });

  it('keeps the normal answer when the park declines', async () => {
    const fixture = setup();

    const result = await fixture.step();

    expect(parkAsyncShell).toHaveBeenCalledTimes(1);
    expect(result.newState.status).not.toBe('waiting_for_async_tool');
    expect(JSON.stringify(fixture.rows)).toContain('shell_id: sh-1');
  });
});
