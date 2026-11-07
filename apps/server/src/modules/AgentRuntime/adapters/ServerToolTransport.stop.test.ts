import type { AgentRuntimeHost, AgentState } from '@lobechat/agent-runtime';
import {
  AgentRuntime,
  createAgentRuntimeExecutors,
  GeneralChatAgent,
} from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentHook } from '@/server/services/agentRuntime/hooks';
import { HookDispatcher } from '@/server/services/agentRuntime/hooks';

import type { RuntimeExecutorContext } from '../context';
import { ServerToolTransport } from './ServerToolTransport';

const { dispatchClient, fetchHook, getEmailsByIds, queueMode, isInterrupted } = vi.hoisted(() => ({
  dispatchClient: vi.fn(),
  fetchHook: vi.fn(),
  getEmailsByIds: vi.fn(),
  queueMode: vi.fn(),
  isInterrupted: vi.fn(),
}));
vi.mock('../dispatchClientTool', () => ({ dispatchClientTool: dispatchClient }));
vi.mock('@/database/models/user', () => ({ UserModel: { getEmailsByIds } }));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: queueMode }));
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
  TOOL_PRICING: { 'fs/write': 5 },
}));

const call = (id = 'native-1'): ChatToolPayload => ({
  id,
  apiName: 'write',
  identifier: 'fs',
  arguments: '{"path":"a"}',
  type: 'builtin',
});
const response = (decision: 'allow' | 'deny', reason?: string) =>
  new Response(JSON.stringify(decision === 'deny' ? { decision, reason } : { decision }));

function setup(hooks: AgentHook[], signal?: AbortSignal, restore = false) {
  const registered = new HookDispatcher();
  registered.register('op', hooks);
  const dispatcher = restore ? new HookDispatcher() : registered;
  const execute = vi.fn().mockResolvedValue({ content: 'executed', success: true });
  const rows: Record<string, unknown>[] = [];
  const state: AgentState = {
    cost: {
      calculatedAt: '',
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
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
    createdAt: '',
    lastModified: '',
    messages: [],
    operationId: 'op',
    status: 'running',
    stepCount: 0,
    origin: { agentId: 'agent', topicId: 'topic' },
    // Serialize to model a worker boundary, not merely an in-memory clone.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    host: { hooks: JSON.parse(JSON.stringify(registered.getSerializedHooks('op') ?? [])) },
    userInterventionConfig: { approvalMode: 'auto-run' },
  };
  const transport = new ServerToolTransport({
    operationId: 'op',
    stepIndex: 1,
    userId: 'user',
    hookDispatcher: dispatcher,
    abortSignal: signal,
    serverDB: {},
    streamManager: { sendToolExecute: vi.fn() },
    toolExecutionService: { executeTool: execute },
  } as unknown as RuntimeExecutorContext);
  const host: AgentRuntimeHost = {
    operation: { operationId: 'op', stepIndex: 1, agentId: 'agent', abortSignal: signal },
    transports: {
      tools: transport,
      messages: {
        createToolMessage: vi.fn(async (row) => {
          rows.push(row);
          return { ...row, id: `row-${rows.length}` };
        }),
        query: vi.fn(async () => rows),
        updateToolMessage: vi.fn(),
        updateToolIntervention: vi.fn(),
        update: vi.fn(),
        findToolMessageIdByToolCallId: vi.fn(),
      } as unknown as AgentRuntimeHost['transports']['messages'],
      stream: { publishEvent: vi.fn(), publishChunk: vi.fn() },
    },
  };
  const executors = createAgentRuntimeExecutors(host);
  const runtime = new AgentRuntime(new GeneralChatAgent({ operationId: 'op' }), {
    executors,
  });
  const step = (calls = [call()]) =>
    runtime.step(state, {
      phase: 'llm_result',
      payload: { hasToolsCalling: true, parentMessageId: 'assistant', toolsCalling: calls },
    });
  return { dispatcher, execute, executors, host, rows, runtime, state, step };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchHook);
  getEmailsByIds.mockReset().mockResolvedValue([]);
  fetchHook.mockReset().mockImplementation(async () => response('allow'));
  queueMode.mockReturnValue(false);
  isInterrupted.mockReset().mockResolvedValue(false);
  dispatchClient.mockReset().mockResolvedValue({ content: 'client result', success: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('environment stop between tool steps', () => {
  it('does not launch another server tool after the persisted interrupt, before local polling catches up', async () => {
    const controller = new AbortController();
    const fixture = setup([], controller.signal);
    isInterrupted.mockResolvedValue(true);
    await fixture.step();
    expect(controller.signal.aborted).toBe(false);
    expect(fixture.execute).not.toHaveBeenCalled();
  });
  it.each(['server', 'client'] as const)(
    'does not launch %s work when abort arrives during the sentinel read',
    async (target) => {
      const controller = new AbortController();
      const fixture = setup([], controller.signal);
      isInterrupted.mockResolvedValueOnce(false).mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            queueMicrotask(() => {
              controller.abort();
              resolve(false);
            });
          }),
      );
      await fixture.step([
        { ...call(), ...(target === 'client' ? { executor: 'client' as const } : {}) },
      ]);
      // The runtime can settle its abort race before the transport resumes.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fixture.execute).not.toHaveBeenCalled();
      expect(dispatchClient).not.toHaveBeenCalled();
    },
  );
});

describe('what a server tool learns about the run', () => {
  it('hands the tool who in the IM conversation asked for the run', async () => {
    const fixture = setup([]);
    const bot = {
      applicationId: 'app-1',
      isOwner: false,
      platform: 'discord',
      platformThreadId: 'discord:g1:c1',
      senderExternalUserId: 'stranger-id',
    };
    fixture.state.principal = { actor: { bot } };

    await fixture.step();

    expect(fixture.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ botContext: bot }),
    );
  });
});

it('routes a resumed MCP approval through its durable executor map when the original payload has no executor annotation', async () => {
  const fixture = setup([]);
  fixture.state.operationToolSet = {
    enabledToolIds: ['fs'],
    executorMap: { fs: 'client' },
    manifestMap: {
      fs: { identifier: 'fs', api: [], meta: {}, mcpParams: { type: 'stdio', command: 'fixture' } },
    },
    sourceMap: { fs: 'mcp' },
  } as NonNullable<AgentState['operationToolSet']>;
  await fixture.step([{ ...call(), type: 'mcp' }]);
  expect(dispatchClient).toHaveBeenCalledOnce();
  expect(fixture.execute).not.toHaveBeenCalled();
});
