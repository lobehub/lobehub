import type { ChatToolPayload } from '@lobechat/types';

import { UsageCounter } from '../core';
import type { AgentRuntimeHost, ToolRunContext, ToolRunResult } from '../transport';
import type {
  AgentEvent,
  AgentInstruction,
  AgentRuntimeContext,
  AgentState,
  InstructionExecutor,
} from '../types';
import { extractActivatedSkillsFromMessages } from '../utils';

const TOOL_EXECUTION_PHASE = 'tool_execution';
const TOOL_MESSAGE_PERSIST_PHASE = 'tool_message_persist';
const DEFAULT_TOOL_MAX_RETRIES = 2;

const persistFatalErrors = new WeakSet<object>();

interface ToolResultEntry {
  data: ToolRunResult;
  executionTime: number;
  isSuccess: boolean;
  toolCall: ChatToolPayload;
  toolCallId: string;
  usageParams?: {
    executionTime: number;
    success: boolean;
    toolCost: number;
    toolName: string;
  };
}

const nowIso = () => new Date().toISOString();

const markPersistFatal = <T>(error: T): T => {
  if (error && typeof error === 'object') persistFatalErrors.add(error);
  return error;
};

const isPersistFatal = (error: unknown) =>
  !!error && typeof error === 'object' && persistFatalErrors.has(error);

const getErrorType = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return;

  const value = (error as { errorType?: unknown; name?: unknown; type?: unknown }).errorType;
  if (typeof value === 'string' || typeof value === 'number') return String(value);

  const type = (error as { type?: unknown }).type;
  if (typeof type === 'string' || typeof type === 'number') return String(type);

  const name = error instanceof Error ? error.name : undefined;
  return name || undefined;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return 'Unknown error';
};

const requireToolTransport = (host: AgentRuntimeHost) => {
  const tools = host.transports.tools;
  if (!tools) {
    throw new Error('ToolTransport is required for tool executors');
  }
  return tools;
};

const toolNameOf = (tool: ChatToolPayload) => `${tool.identifier}/${tool.apiName}`;

const resolveToolSource = (state: AgentState, tool: ChatToolPayload): string | undefined =>
  state.operationToolSet?.sourceMap?.[tool.identifier] ?? state.toolSourceMap?.[tool.identifier];

const parseToolArgs = (tool: ChatToolPayload): Record<string, unknown> => {
  try {
    if (typeof tool.arguments === 'string') {
      const parsed = JSON.parse(tool.arguments) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    }

    return tool.arguments && typeof tool.arguments === 'object'
      ? (tool.arguments as Record<string, unknown>)
      : {};
  } catch {
    // Execution still receives the raw arguments; this preview is only for hooks.
    return {};
  }
};

const buildEffectiveManifestMap = (state: AgentState): Record<string, any> => ({
  ...(state.operationToolSet?.manifestMap ?? state.toolManifestMap),
  ...Object.fromEntries(
    (state.activatedStepTools ?? [])
      .filter((activation) => activation.manifest)
      .map((activation) => [activation.id, activation.manifest!]),
  ),
});

const resolveCallIndex = (state: AgentState, toolName: string) => {
  const existingToolStats = state.usage?.tools?.byTool?.find((tool) => tool.name === toolName);
  return (existingToolStats?.calls ?? 0) + 1;
};

const createRunContext = ({
  host,
  mode,
  parentMessageId,
  reuseExistingMessage,
  state,
  stepContext,
  tool,
}: {
  host: AgentRuntimeHost;
  mode: ToolRunContext['mode'];
  parentMessageId: string;
  reuseExistingMessage?: boolean;
  state: AgentState;
  stepContext?: AgentRuntimeContext['stepContext'];
  tool: ChatToolPayload;
}): ToolRunContext => {
  const toolName = toolNameOf(tool);
  const toolSource = resolveToolSource(state, tool);
  const agentConfig = state.metadata?.agentConfig as
    { chatConfig?: { toolResultMaxLength?: number } } | undefined;

  return {
    activatedSkills: extractActivatedSkillsFromMessages(state.messages),
    agentId: host.operation.agentId ?? state.metadata?.agentId,
    assistantMessageId: parentMessageId,
    callIndex: resolveCallIndex(state, toolName),
    effectiveManifestMap: buildEffectiveManifestMap(state),
    groupId: host.operation.groupId ?? state.metadata?.groupId,
    messageId: state.metadata?.sourceMessageId,
    mode,
    operationId: host.operation.operationId,
    parentMessageId,
    parsedArgs: parseToolArgs(tool),
    reuseExistingMessage,
    state,
    stepIndex: host.operation.stepIndex,
    stepContext,
    threadId: host.operation.threadId ?? state.metadata?.threadId,
    toolName,
    toolResultMaxLength: agentConfig?.chatConfig?.toolResultMaxLength,
    toolSource,
    topicId: host.operation.topicId ?? state.metadata?.topicId,
    workspaceId: state.metadata?.workspaceId ?? host.operation.workspaceId,
  };
};

const publishError = async (host: AgentRuntimeHost, error: unknown, phase: string) => {
  const { stepIndex } = host.operation;

  if (host.transports.stream.publishError) {
    await host.transports.stream.publishError({ error, phase, stepIndex });
    return;
  }

  await host.transports.stream.publishEvent({
    data: {
      error: getErrorMessage(error),
      errorType: getErrorType(error),
      phase,
    },
    stepIndex,
    type: 'error',
  });
};

/**
 * A deferred tool's runtime has already created the row its result will be
 * backfilled into (e.g. `callSubAgent`'s pending placeholder) and hands the id
 * back on the execution state. Lift it out so the pause chunk can advertise it.
 */
const deferredToolMessageId = (result: { state?: unknown }): string | undefined => {
  const state = result.state as { toolMessageId?: unknown } | undefined;
  return typeof state?.toolMessageId === 'string' ? state.toolMessageId : undefined;
};

const pauseForTools = async ({
  host,
  instruction,
  reason,
  state,
  toolMessageIds,
  toolsCalling,
}: {
  host: AgentRuntimeHost;
  instruction?: AgentInstruction;
  reason: string;
  state: AgentState;
  /**
   * `tool_call_id → tool message id`, for pending tools whose row the server has
   * already created (today: deferred async tools such as `callSubAgent`). Tells
   * the client to pull those rows in — without it the parked parent's placeholder
   * never reaches the store, and anything addressed at it silently no-ops.
   * Same optional field the human-approval pause chunk carries; legacy consumers
   * ignore it.
   */
  toolMessageIds?: Record<string, string>;
  toolsCalling: ChatToolPayload[];
}) => {
  await host.transports.stream.publishChunk({
    chunkType: 'tools_calling',
    stepIndex: host.operation.stepIndex,
    ...(toolMessageIds && Object.keys(toolMessageIds).length > 0 && { toolMessageIds }),
    toolsCalling,
  });

  const interruptedAt = nowIso();
  const newState = structuredClone(state);
  newState.lastModified = interruptedAt;
  newState.status = 'waiting_for_async_tool';
  newState.interruption = {
    canResume: true,
    interruptedAt,
    ...(instruction && { interruptedInstruction: instruction }),
    reason,
  };
  newState.pendingToolsCalling = toolsCalling;

  return {
    events: [
      {
        canResume: true,
        interruptedAt,
        reason,
        type: 'interrupted' as const,
      },
    ],
    newState,
  };
};

const createToolMessage = async ({
  host,
  parentMessageId,
  result,
  state,
  tool,
}: {
  host: AgentRuntimeHost;
  parentMessageId: string;
  result: ToolRunResult;
  state: AgentState;
  tool: ChatToolPayload;
}) => {
  try {
    const agentId = host.operation.agentId ?? state.metadata?.agentId;
    if (!agentId) {
      throw new Error(
        `[call_tool] Missing agentId for tool message (op=${host.operation.operationId})`,
      );
    }

    return await host.transports.messages.createToolMessage({
      agentId,
      content: result.content,
      groupId: host.operation.groupId ?? state.metadata?.groupId ?? undefined,
      metadata: { toolExecutionTimeMs: result.executionTime ?? 0 },
      parentId: parentMessageId,
      plugin: tool as any,
      pluginError: result.error,
      pluginState: result.state,
      role: 'tool',
      threadId: host.operation.threadId ?? state.metadata?.threadId,
      tool_call_id: tool.id,
      topicId: host.operation.topicId ?? state.metadata?.topicId,
    });
  } catch (error) {
    await publishError(host, error, TOOL_MESSAGE_PERSIST_PHASE);
    throw markPersistFatal(error);
  }
};

const updateExistingToolMessage = async ({
  host,
  result,
  toolMessageId,
}: {
  host: AgentRuntimeHost;
  result: ToolRunResult;
  toolMessageId: string;
}) => {
  try {
    await host.transports.messages.updateToolMessage(toolMessageId, {
      content: result.content,
      metadata: { toolExecutionTimeMs: result.executionTime ?? 0 },
      pluginError: result.error,
      pluginState: result.state,
    });
  } catch (error) {
    await publishError(host, error, TOOL_MESSAGE_PERSIST_PHASE);
    throw markPersistFatal(error);
  }
};

const persistActivatedTools = ({
  effectiveManifestMap,
  newState,
  results,
  stepCount,
}: {
  effectiveManifestMap: Record<string, any>;
  newState: AgentState;
  results: ToolResultEntry[];
  stepCount: number;
}) => {
  const existingIds = new Set((newState.activatedStepTools ?? []).map((tool) => tool.id));

  for (const result of results) {
    const discoveredTools = result.data.state?.activatedTools as
      Array<{ identifier: string }> | undefined;
    if (!discoveredTools?.length) continue;

    const newActivations = discoveredTools
      .filter((tool) => !existingIds.has(tool.identifier))
      .map((tool) => ({
        activatedAtStep: stepCount,
        id: tool.identifier,
        manifest: effectiveManifestMap[tool.identifier],
        source: 'discovery' as const,
      }));

    for (const activation of newActivations) existingIds.add(activation.id);

    if (newActivations.length > 0) {
      newState.activatedStepTools = [...(newState.activatedStepTools ?? []), ...newActivations];
    }
  }
};

export const callTool =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state, runtimeContext) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tool' }>;
    const tools = requireToolTransport(host);
    const tool = payload.toolCalling;
    const events: AgentEvent[] = [];
    const runContext = createRunContext({
      host,
      mode: 'single',
      parentMessageId: payload.parentMessageId,
      reuseExistingMessage: payload.skipCreateToolMessage,
      state,
      stepContext: runtimeContext?.stepContext,
      tool,
    });

    await host.transports.stream.publishEvent({
      data: payload,
      stepIndex: host.operation.stepIndex,
      type: 'tool_start',
    });

    if (runContext.toolSource === 'client' && !tools.canRunClientTools) {
      return pauseForTools({
        host,
        instruction,
        reason: 'client_tool_execution',
        state,
        toolsCalling: [tool],
      });
    }

    try {
      const execution = await tools.run(tool, runContext);

      if (execution.interrupted) {
        return { events, newState: state };
      }

      if (execution.result.deferred) {
        const deferredId = deferredToolMessageId(execution.result);
        return pauseForTools({
          host,
          reason: 'async_tool',
          state,
          toolMessageIds: deferredId ? { [tool.id]: deferredId } : undefined,
          toolsCalling: [tool],
        });
      }

      const executionResult = execution.result;
      const executionTime = executionResult.executionTime ?? 0;
      const isSuccess = executionResult.success;

      await host.transports.stream.publishEvent({
        data: {
          executionTime,
          isSuccess,
          attempts: execution.attempts,
          maxAttempts: (tools.maxRetries ?? DEFAULT_TOOL_MAX_RETRIES) + 1,
          payload,
          phase: TOOL_EXECUTION_PHASE,
          result: executionResult,
        },
        stepIndex: host.operation.stepIndex,
        type: 'tool_end',
      });

      let toolMessageId: string;
      if (execution.toolMessageId) {
        toolMessageId = execution.toolMessageId;
        if (!execution.resultPersisted) {
          await updateExistingToolMessage({ host, result: executionResult, toolMessageId });
        }
      } else if (payload.skipCreateToolMessage) {
        toolMessageId = payload.parentMessageId;
        await updateExistingToolMessage({ host, result: executionResult, toolMessageId });
      } else {
        const toolMessage = await createToolMessage({
          host,
          parentMessageId: payload.parentMessageId,
          result: executionResult,
          state,
          tool,
        });
        toolMessageId = toolMessage.id;
      }

      const newState = structuredClone(state);
      if (execution.resultPersisted) {
        newState.messages = await host.transports.messages.query({
          agentId: runContext.agentId,
          groupId: runContext.groupId,
          threadId: runContext.threadId,
          topicId: runContext.topicId,
        });
      } else {
        newState.messages.push({
          content: executionResult.content,
          plugin: tool,
          pluginState: executionResult.state,
          role: 'tool',
          tool_call_id: tool.id,
        });
      }
      newState.lastModified = nowIso();

      events.push({ id: tool.id, result: executionResult, type: 'tool_result' });

      const toolCost = tools.getCost?.(runContext.toolName) ?? 0;
      const { usage, cost } = UsageCounter.accumulateTool({
        cost: newState.cost,
        executionTime,
        success: isSuccess,
        toolCost,
        toolName: runContext.toolName,
        usage: newState.usage,
      });

      newState.usage = usage;
      if (cost) newState.cost = cost;

      persistActivatedTools({
        effectiveManifestMap: runContext.effectiveManifestMap,
        newState,
        results: [
          {
            data: executionResult,
            executionTime,
            isSuccess,
            toolCall: tool,
            toolCallId: tool.id,
          },
        ],
        stepCount: state.stepCount,
      });

      const legacyAgentInvocationStateType = executionResult.state?.type as string | undefined;
      const isLegacyAgentInvocationState =
        legacyAgentInvocationStateType === 'execSubAgent' ||
        legacyAgentInvocationStateType === 'execSubAgents' ||
        legacyAgentInvocationStateType === 'execClientSubAgent' ||
        legacyAgentInvocationStateType === 'execClientSubAgents';

      if (executionResult.stop && !isLegacyAgentInvocationState) {
        newState.status = 'done';
        return { events, newState };
      }

      return {
        events,
        newState,
        nextContext: {
          payload: {
            data: executionResult,
            executionTime,
            isSuccess,
            parentMessageId: toolMessageId,
            ...(isLegacyAgentInvocationState && { stop: true }),
            toolCall: tool,
            toolCallId: tool.id,
          },
          phase: 'tool_result',
          session: {
            eventCount: events.length,
            messageCount: newState.messages.length,
            sessionId: host.operation.operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
          stepUsage: {
            cost: toolCost,
            toolName: runContext.toolName,
            unitPrice: toolCost,
            usageCount: 1,
          },
        },
      };
    } catch (error) {
      if (isPersistFatal(error)) throw error;

      await tools.handleError?.(tool, error, runContext);
      await publishError(host, error, TOOL_EXECUTION_PHASE);

      events.push({ error, type: 'error' });

      return {
        events,
        newState: state,
      };
    }
  };

export const callToolsBatch =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tools_batch' }>;
    const parentMessageId = payload.parentMessageId as string;
    const toolsCalling = payload.toolsCalling as ChatToolPayload[];
    const tools = requireToolTransport(host);
    const events: AgentEvent[] = [];
    const clientTools: ChatToolPayload[] = [];
    const serverTools: ChatToolPayload[] = [];

    for (const tool of toolsCalling) {
      if (resolveToolSource(state, tool) === 'client' && !tools.canRunClientTools)
        clientTools.push(tool);
      else serverTools.push(tool);
    }

    if (clientTools.length > 0 && serverTools.length === 0) {
      return pauseForTools({
        host,
        reason: 'client_tool_execution',
        state,
        toolsCalling: clientTools,
      });
    }

    const toolMessageIds: string[] = [];
    const toolResults: ToolResultEntry[] = [];
    const deferredTools: ChatToolPayload[] = [];
    // `tool_call_id → placeholder message id` for the deferred tools in this batch.
    const deferredToolMessageIds: Record<string, string> = {};
    const toolsToExecute = serverTools.length > 0 ? serverTools : toolsCalling;

    await Promise.all(
      toolsToExecute.map(async (tool) => {
        const runContext = createRunContext({ host, mode: 'batch', parentMessageId, state, tool });

        await host.transports.stream.publishEvent({
          data: { parentMessageId, toolCalling: tool },
          stepIndex: host.operation.stepIndex,
          type: 'tool_start',
        });

        try {
          const execution = await tools.run(tool, runContext);

          if (execution.result.deferred) {
            deferredTools.push(tool);
            const deferredId = deferredToolMessageId(execution.result);
            if (deferredId) deferredToolMessageIds[tool.id] = deferredId;
            return;
          }

          const executionResult = execution.result;
          const executionTime = executionResult.executionTime ?? 0;
          const isSuccess = executionResult.success;

          await host.transports.stream.publishEvent({
            data: {
              executionTime,
              isSuccess,
              attempts: execution.attempts,
              maxAttempts: (tools.maxRetries ?? DEFAULT_TOOL_MAX_RETRIES) + 1,
              payload: { parentMessageId, toolCalling: tool },
              phase: TOOL_EXECUTION_PHASE,
              result: executionResult,
            },
            stepIndex: host.operation.stepIndex,
            type: 'tool_end',
          });

          let toolMessageId: string;
          if (execution.toolMessageId) {
            toolMessageId = execution.toolMessageId;
            if (!execution.resultPersisted) {
              await updateExistingToolMessage({ host, result: executionResult, toolMessageId });
            }
          } else {
            const toolMessage = await createToolMessage({
              host,
              parentMessageId,
              result: executionResult,
              state,
              tool,
            });
            toolMessageId = toolMessage.id;
          }
          toolMessageIds.push(toolMessageId);

          const resultEntry: ToolResultEntry = {
            data: executionResult,
            executionTime,
            isSuccess,
            toolCall: tool,
            toolCallId: tool.id,
          };

          events.push({ id: tool.id, result: executionResult, type: 'tool_result' });

          const toolCost = tools.getCost?.(runContext.toolName) ?? 0;
          resultEntry.usageParams = {
            executionTime,
            success: isSuccess,
            toolCost,
            toolName: runContext.toolName,
          };
          toolResults.push(resultEntry);
        } catch (error) {
          if (isPersistFatal(error)) throw error;

          await tools.handleError?.(tool, error, runContext);
          await publishError(host, error, TOOL_EXECUTION_PHASE);

          events.push({ error, type: 'error' });
        }
      }),
    );

    const newState = structuredClone(state);
    for (const result of toolResults) {
      if (!result.usageParams) continue;

      const { usage, cost } = UsageCounter.accumulateTool({
        ...result.usageParams,
        cost: newState.cost,
        usage: newState.usage,
      });
      newState.usage = usage;
      if (cost) newState.cost = cost;
    }

    persistActivatedTools({
      effectiveManifestMap: buildEffectiveManifestMap(state),
      newState,
      results: toolResults,
      stepCount: state.stepCount,
    });

    newState.messages = await host.transports.messages.query(
      {
        agentId: state.metadata?.agentId,
        groupId: state.metadata?.groupId,
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      },
      { flatten: true, resolveAssetUrls: true },
    );
    newState.lastModified = nowIso();

    const pendingTools = [...deferredTools, ...clientTools];
    if (pendingTools.length > 0) {
      const pauseReason = deferredTools.length > 0 ? 'async_tool' : 'client_tool_execution';

      const paused = await pauseForTools({
        host,
        reason: pauseReason,
        state: newState,
        toolMessageIds: deferredToolMessageIds,
        toolsCalling: pendingTools,
      });

      return {
        events: [...events, ...paused.events],
        newState: paused.newState,
      };
    }

    return {
      events,
      newState,
      nextContext: {
        payload: {
          parentMessageId: toolMessageIds.at(-1) ?? parentMessageId,
          toolCount: toolsCalling.length,
          toolResults,
        },
        phase: 'tools_batch_result',
        session: {
          eventCount: events.length,
          messageCount: newState.messages.length,
          sessionId: host.operation.operationId,
          status: 'running',
          stepCount: state.stepCount + 1,
        },
      },
    };
  };
