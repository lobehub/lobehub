import type { AgentRuntimeHost, AgentState, GeneralAgentConfig } from '@lobechat/agent-runtime';
import {
  AgentRuntime,
  createAgentRuntimeExecutors,
  createToolPreparation,
  GeneralChatAgent,
} from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';
import { vi } from 'vitest';

import type { AgentHook } from '@/server/services/agentRuntime/hooks';
import { HookDispatcher } from '@/server/services/agentRuntime/hooks';

import type { RuntimeExecutorContext } from '../context';
import { createRuntimeToolPreparation } from '../RuntimeExecutors';
import { guardToolApproval } from '../toolCancellation';
import { ServerToolTransport } from './ServerToolTransport';

const call = (): ChatToolPayload => ({
  id: 'native-1',
  apiName: 'write',
  identifier: 'fs',
  arguments: '{"path":"a"}',
  type: 'builtin',
});

export function setupToolControlPipeline(
  hooks: AgentHook[],
  signal?: AbortSignal,
  restore = false,
  options: {
    checkToolCancellation?: () => Promise<boolean>;
    operationId?: string;
    globalInterventionAudits?: GeneralAgentConfig['globalInterventionAudits'];
    Runtime?: typeof AgentRuntime;
    serverPreparation?: boolean;
  } = {},
) {
  const operationId = options.operationId ?? 'op';
  const registered = new HookDispatcher();
  registered.register(operationId, hooks);
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
    operationId,
    status: 'running',
    stepCount: 0,
    origin: { agentId: 'agent', topicId: 'topic' },
    // Serialize to model a worker boundary, not merely an in-memory clone.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    host: { hooks: JSON.parse(JSON.stringify(registered.getSerializedHooks(operationId) ?? [])) },
    userInterventionConfig: { approvalMode: 'auto-run' },
  };
  const streamManager = {} as RuntimeExecutorContext['streamManager'];
  const executorContext = {
    operationId,
    stepIndex: 1,
    userId: 'user',
    hookDispatcher: dispatcher,
    abortSignal: signal,
    checkToolCancellation: options.checkToolCancellation,
    serverDB: {},
    streamManager,
    toolExecutionService: { executeTool: execute },
  } as unknown as RuntimeExecutorContext;
  const transport = new ServerToolTransport(executorContext);
  const host: AgentRuntimeHost = {
    operation: { operationId, stepIndex: 1, agentId: 'agent', abortSignal: signal },
    transports: {
      tools: transport,
      messages: {
        createToolMessage: vi.fn(async (row) => {
          const saved = { ...row, id: `row-${rows.length + 1}` };
          rows.push(saved);
          return saved;
        }),
        query: vi.fn(async () => rows),
        updateToolCall: vi.fn(async (id, args, preparation) => {
          const row = rows.find((row) => row.id === id);
          if (row) {
            row.plugin = { ...(row.plugin as object), arguments: args };
            row.pluginState = {
              ...(row.pluginState as object),
              hookPreparation: structuredClone(preparation),
            };
          }
        }),
        updateToolMessage: vi.fn(async (id, params) => {
          const row = rows.find((row) => row.id === id);
          if (row)
            Object.assign(row, params, {
              pluginState: { ...(row.pluginState as object), ...params.pluginState },
            });
        }),
        updateToolIntervention: vi.fn(async (id, intervention) => {
          const row = rows.find((row) => row.id === id);
          if (row) row.pluginIntervention = intervention;
        }),
        deleteMessage: vi.fn(),
        update: vi.fn(),
        findToolMessageIdByToolCallId: vi.fn(),
      } as unknown as AgentRuntimeHost['transports']['messages'],
      stream: { publishEvent: vi.fn(), publishChunk: vi.fn() },
    },
  };
  const executors = createAgentRuntimeExecutors(host);
  if (options.serverPreparation)
    executors.request_human_approve = guardToolApproval(
      executorContext,
      executors.request_human_approve!,
      executors.resolve_aborted_tools!,
    );
  const runtime = new (options.Runtime ?? AgentRuntime)(
    new GeneralChatAgent({
      operationId,
      globalInterventionAudits: options.globalInterventionAudits,
    }),
    {
      executors,
      prepareTools: options.serverPreparation
        ? createRuntimeToolPreparation(executorContext)
        : createToolPreparation(host),
    },
  );
  const step = (calls = [call()]) =>
    runtime.step(state, {
      phase: 'llm_result',
      payload: { hasToolsCalling: true, parentMessageId: 'assistant', toolsCalling: calls },
    });
  return { dispatcher, execute, executors, host, rows, runtime, state, step, streamManager };
}
