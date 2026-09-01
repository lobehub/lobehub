import type { ChatToolPayload, WorkRegistrationIntent } from '@lobechat/types';

import { UsageCounter } from '../core';
import type {
  AgentRuntimeHost,
  ToolRunContext,
  ToolRunResult,
  ToolWorkRegistration,
} from '../transport';
import type {
  AgentEvent,
  AgentInstruction,
  AgentRuntimeContext,
  AgentState,
  InstructionExecutor,
} from '../types';
import { extractActivatedSkillsFromMessages, extractTodosFromMessages } from '../utils';
import { settleAbortedToolRows } from './abortedToolRows';

const TOOL_EXECUTION_PHASE = 'tool_execution';
const TOOL_MESSAGE_PERSIST_PHASE = 'tool_message_persist';
const DEFAULT_TOOL_MAX_RETRIES = 2;

const persistFatalErrors = new WeakSet<object>();

interface ToolResultEntry {
  data: ToolRunResult;
  executionTime: number;
  isSuccess: boolean;
  /** Tool message this result was persisted to — provenance for Work versions. */
  sourceMessageId?: string;
  toolCall: ChatToolPayload;
  toolCallId: string;
  usageParams?: {
    executionTime: number;
    success: boolean;
    toolCost: number;
    toolName: string;
  };
  /** Carried so the post-batch accumulate loop can persist the Work version. */
  workRegistration?: WorkRegistrationIntent;
}

const nowIso = () => new Date().toISOString();

/**
 * Skill work-registration intents carry the UNTRUNCATED tool payload
 * (`data`/`args`) solely for server-side Work registration, which reads it
 * off the in-process `executionResult` before anything leaves the executor.
 * Strip it from every copy that DOES leave: realtime `tool_end` stream events
 * (clients only read `workRegistration` as a presence flag, see
 * gatewayEventHandler) and the recorded step `tool_result` events
 * (AgentStateManager serializes those into Redis, where the raw payload would
 * bloat the capped event blob).
 */
const redactResultForEvents = (result: ToolRunResult): ToolRunResult =>
  result.workRegistration?.type === 'skill'
    ? { ...result, workRegistration: { ...result.workRegistration, args: undefined, data: null } }
    : result;

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
  toolMessageId,
}: {
  host: AgentRuntimeHost;
  mode: ToolRunContext['mode'];
  parentMessageId: string;
  reuseExistingMessage?: boolean;
  state: AgentState;
  stepContext?: AgentRuntimeContext['stepContext'];
  tool: ChatToolPayload;
  toolMessageId?: string;
}): ToolRunContext => {
  const toolName = toolNameOf(tool);
  const toolSource = resolveToolSource(state, tool);
  const agentConfig = state.metadata?.agentConfig as
    { chatConfig?: { toolResultMaxLength?: number } } | undefined;

  return {
    abortSignal: host.operation.abortSignal,
    activatedSkills: extractActivatedSkillsFromMessages(state.messages),
    agentId: host.operation.agentId ?? state.metadata?.agentId,
    assistantMessageId: parentMessageId,
    callIndex: resolveCallIndex(state, toolName),
    // Todo state is reconstructed from message history for the same reason the
    // prompt side does it (`serverCallLlmContextBuilder`): the plan document is
    // a best-effort mirror that only exists once `createPlan` has run, so the
    // tool-execution side must not treat it as the source of truth.
    currentTodos: extractTodosFromMessages(state.messages)?.items,
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
    toolMessageId,
    toolName,
    toolResultMaxLength: agentConfig?.chatConfig?.toolResultMaxLength,
    toolSource,
    topicId: host.operation.topicId ?? state.metadata?.topicId,
    workspaceId: state.metadata?.workspaceId ?? host.operation.workspaceId,
  };
};

class ToolAbortedError extends Error {
  constructor() {
    super('Tool execution aborted');
    this.name = 'AbortError';
  }
}

/**
 * Did this rejection come from the operation being aborted?
 *
 * Name-matching alone is wrong: a transport's own fetch timeout or an internal
 * cancellation also rejects with `AbortError`, and treating that as "the user
 * pressed Stop" would swallow `handleError`, drop the error telemetry, and
 * persist a row claiming the user aborted a tool that actually failed.
 *
 * Our sentinel is definitive. A foreign `AbortError` only counts when the
 * operation signal is genuinely aborted — that is a transport honouring the
 * signal we handed it, which is the same event by another route.
 */
const isOperationAbort = (error: unknown, signal?: AbortSignal): boolean => {
  if (error instanceof ToolAbortedError) return true;

  return !!signal?.aborted && error instanceof Error && error.name === 'AbortError';
};

/**
 * Run a tool, but stop waiting the moment the operation is aborted.
 *
 * The transport may keep running in the background — work already handed to a
 * device or a remote process cannot be recalled. What this buys is the step
 * boundary arriving at once instead of after a multi-minute tool, and the
 * caller settling the call's row rather than leaving it open forever.
 */
const raceToolAbort = async <T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return run();
  // Checked BEFORE `run()` — taking a thunk rather than a promise is the whole
  // point. With an already-aborted signal (the poll fired as this executor was
  // entered) an eagerly-evaluated argument would have launched the tool, and no
  // transport inspects `context.abortSignal` before starting its own work, so
  // Stop would still spawn the process and only record an aborted row after.
  if (signal.aborted) throw new ToolAbortedError();

  const started = run();

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ToolAbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    // Observe the transport before the synchronous-abort recheck below. The
    // outer race may already be settled, but a started transport can still
    // reject later and must not surface as an unhandled rejection.
    started.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    // The signal can fire between `run()` starting and the listener attaching —
    // a transport that aborts from inside its own synchronous setup does exactly
    // that. Without this re-check the listener is registered too late, nothing
    // rejects, and a run that never settles hangs the step forever.
    if (signal.aborted) {
      reject(new ToolAbortedError());
      return;
    }
  });
};

/**
 * Close out one call that an abort caught mid-flight.
 *
 * Settled inline, in the same invocation that noticed the abort, rather than
 * handed to a later step: everything needed is already here, and a follow-up
 * step is exactly what cannot be relied on once a run is being torn down.
 * `status` deliberately stays as-is — whether the run ends is the caller's
 * decision (a user Stop persists `interrupted` independently), not this
 * executor's.
 */
const settleAbortedCall = async ({
  events,
  existingToolMessageId,
  host,
  parentMessageId,
  state,
  tool,
}: {
  events: AgentEvent[];
  existingToolMessageId?: string;
  host: AgentRuntimeHost;
  parentMessageId: string;
  state: AgentState;
  tool: ChatToolPayload;
}) => {
  const settled = await settleAbortedToolRows({
    existingToolMessageIds: existingToolMessageId
      ? { [tool.id]: existingToolMessageId }
      : undefined,
    host,
    parentMessageId,
    state,
    toolsCalling: [tool],
  });

  const newState = structuredClone(state);
  newState.messages.push(...settled.messages);
  newState.lastModified = nowIso();

  return {
    events,
    newState,
    nextContext: {
      payload: { parentMessageId: settled.messageIds[tool.id] ?? parentMessageId },
      phase: 'tool_result' as const,
      session: {
        messageCount: newState.messages.length,
        sessionId: host.operation.operationId,
        status: newState.status,
        stepCount: state.stepCount + 1,
      },
    },
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
      toolMessageId: payload.skipCreateToolMessage ? payload.parentMessageId : undefined,
    });

    await host.transports.stream.publishEvent({
      data: payload,
      stepIndex: host.operation.stepIndex,
      type: 'tool_start',
    });

    if (runContext.toolSource === 'client' && !tools.canRunClientTools) {
      // Parking is only meaningful if something will come back for it. Once the
      // operation is aborted nothing resumes this run, so the pause would leave
      // the call with no row at all — settle it instead.
      if (host.operation.abortSignal?.aborted) {
        return settleAbortedCall({
          events,
          existingToolMessageId: payload.skipCreateToolMessage
            ? payload.parentMessageId
            : undefined,
          host,
          parentMessageId: payload.parentMessageId,
          state,
          tool,
        });
      }

      const paused = await pauseForTools({
        host,
        instruction,
        reason: 'client_tool_execution',
        state,
        toolsCalling: [tool],
      });

      // Stop can arrive while the chunk is being published. Do not return a
      // parked state after that asynchronous gap: no client result will ever
      // resume an operation that has already been interrupted.
      if (host.operation.abortSignal?.aborted) {
        return settleAbortedCall({
          events,
          existingToolMessageId: payload.skipCreateToolMessage
            ? payload.parentMessageId
            : undefined,
          host,
          parentMessageId: payload.parentMessageId,
          state,
          tool,
        });
      }

      return paused;
    }

    try {
      const execution = await raceToolAbort(
        () => tools.run(tool, runContext),
        host.operation.abortSignal,
      );

      if (execution.interrupted) {
        // The transport bailed after creating its optimistic row but before a
        // result existed. Close the call out here — returning `state` untouched
        // used to strand the tool_call_id with no row at all.
        return settleAbortedCall({
          events,
          existingToolMessageId: payload.skipCreateToolMessage
            ? payload.parentMessageId
            : undefined,
          host,
          parentMessageId: payload.parentMessageId,
          state,
          tool,
        });
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
          result: redactResultForEvents(executionResult),
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
        /**
         * Preserve the durable row id in the in-memory turn. The next gateway
         * step uses message ids to rebuild media refs before its DB rehydrate,
         * and an id-less tool result makes that safety gate keep the stale
         * snapshot instead.
         */
        newState.messages.push({
          content: executionResult.content,
          id: toolMessageId,
          plugin: tool,
          pluginState: executionResult.state,
          role: 'tool',
          tool_call_id: tool.id,
        });
      }
      newState.lastModified = nowIso();

      events.push({
        id: tool.id,
        result: redactResultForEvents(executionResult),
        type: 'tool_result',
      });

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

      // Persist the Work version ONCE, now that `accumulateTool` has resolved
      // the cumulative cost. The tool execution only produced the registration
      // intent (task / skill / document identity); provenance + cost are
      // stamped here at insert time — no cost-less insert + later backfill.
      if (executionResult.workRegistration) {
        await tools.registerWork?.(
          {
            intent: executionResult.workRegistration,
            sourceMessageId: toolMessageId,
            sourceToolCallId: tool.id,
            sourceToolIdentifier: tool.identifier,
            sourceToolName: tool.apiName,
            state: { cost: newState.cost, usage: newState.usage },
          },
          newState,
        );
      }

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
        legacyAgentInvocationStateType === 'execSubAgents';

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
            // Server-observed span vs the device's own — their difference is
            // the dispatch overhead, which only the trace can show after the fact.
            deviceExecutionTime: execution.result.deviceExecutionTime,
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

      // An abort is not a tool failure: no error row, no retry bookkeeping,
      // no `handleError`. Just close the call out with an aborted row.
      if (isOperationAbort(error, host.operation.abortSignal)) {
        return settleAbortedCall({
          events,
          existingToolMessageId: payload.skipCreateToolMessage
            ? payload.parentMessageId
            : undefined,
          host,
          parentMessageId: payload.parentMessageId,
          state,
          tool,
        });
      }

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
  async (instruction, state, runtimeContext) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tools_batch' }>;
    const parentMessageId = payload.parentMessageId as string;
    const toolsCalling = payload.toolsCalling as ChatToolPayload[];
    // Batch human approval resumes onto rows the approval pause already created.
    const existingToolMessageIds = (payload.existingToolMessageIds ?? {}) as Record<string, string>;
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
      // Same reasoning as the single-call path: an aborted run never comes back
      // to collect these, so parking them strands every tool_call_id in the batch.
      if (host.operation.abortSignal?.aborted) {
        const { messages } = await settleAbortedToolRows({
          existingToolMessageIds,
          host,
          parentMessageId,
          state,
          toolsCalling: clientTools,
        });
        const abortedState = structuredClone(state);
        abortedState.messages.push(...messages);
        abortedState.lastModified = nowIso();

        return { events, newState: abortedState };
      }

      const paused = await pauseForTools({
        host,
        reason: 'client_tool_execution',
        state,
        toolsCalling: clientTools,
      });

      if (host.operation.abortSignal?.aborted) {
        const { messages } = await settleAbortedToolRows({
          existingToolMessageIds,
          host,
          parentMessageId,
          state,
          toolsCalling: clientTools,
        });
        const abortedState = structuredClone(state);
        abortedState.messages.push(...messages);
        abortedState.lastModified = nowIso();

        return { events, newState: abortedState };
      }

      return paused;
    }

    const toolResults: ToolResultEntry[] = [];
    /**
     * Calls this batch could not settle because the operation was aborted
     * mid-flight. Tracked separately from `deferredTools` (which are alive and
     * will call back) — these need `aborted` rows before the next `call_llm`.
     */
    const abortedTools: ChatToolPayload[] = [];
    const deferredTools: ChatToolPayload[] = [];
    // `tool_call_id → placeholder message id` for the deferred tools in this batch.
    const deferredToolMessageIds: Record<string, string> = {};
    const toolsToExecute = serverTools.length > 0 ? serverTools : toolsCalling;

    await Promise.all(
      toolsToExecute.map(async (tool) => {
        const existingMessageId = existingToolMessageIds[tool.id];
        const runContext = createRunContext({
          host,
          mode: 'batch',
          parentMessageId,
          reuseExistingMessage: !!existingMessageId,
          state,
          stepContext: runtimeContext?.stepContext,
          tool,
          toolMessageId: existingMessageId,
        });

        await host.transports.stream.publishEvent({
          data: { parentMessageId, toolCalling: tool },
          stepIndex: host.operation.stepIndex,
          type: 'tool_start',
        });

        try {
          const execution = await raceToolAbort(
            () => tools.run(tool, runContext),
            host.operation.abortSignal,
          );

          if (execution.interrupted) {
            abortedTools.push(tool);
            return;
          }

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
              result: redactResultForEvents(executionResult),
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
          } else if (existingMessageId) {
            // Batch approval resume: fill the pending placeholder in place.
            // Creating a fresh row here would leave the approved-but-empty
            // original stranded under the same assistant.
            toolMessageId = existingMessageId;
            await updateExistingToolMessage({ host, result: executionResult, toolMessageId });
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

          // `sourceMessageId` + `workRegistration` are carried so the
          // post-batch accumulate loop can persist the Work version ONCE with
          // this call's cumulative cost (known only then).
          const resultEntry: ToolResultEntry = {
            data: executionResult,
            executionTime,
            isSuccess,
            sourceMessageId: toolMessageId,
            toolCall: tool,
            toolCallId: tool.id,
            workRegistration: executionResult.workRegistration,
          };

          events.push({
            id: tool.id,
            result: redactResultForEvents(executionResult),
            type: 'tool_result',
          });

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

          // Abort is not a tool failure — see `callTool`. Siblings that already
          // finished keep their real results; this one is collected for the
          // aborted-row settle after the batch.
          if (isOperationAbort(error, host.operation.abortSignal)) {
            abortedTools.push(tool);
            return;
          }

          await tools.handleError?.(tool, error, runContext);
          await publishError(host, error, TOOL_EXECUTION_PHASE);

          events.push({ error, type: 'error' });
        }
      }),
    );

    // Client tools in a mixed batch never entered `toolsToExecute` — they were
    // waiting for the pause below to hand them to the client. Once the operation
    // is aborted that pause parks calls into a run nothing will resume, so their
    // tool_call_ids would keep no rows at all. Settle them alongside the ones
    // caught mid-flight, and skip the pause entirely.
    const aborted = host.operation.abortSignal?.aborted ?? false;
    const unstartedOnAbort = aborted ? clientTools : [];
    const toSettle = [...abortedTools, ...unstartedOnAbort];

    // Close out everything the abort left unsettled BEFORE the message refresh
    // below, so the rows are part of the state this step returns.
    if (toSettle.length > 0) {
      await settleAbortedToolRows({
        existingToolMessageIds,
        host,
        parentMessageId,
        state,
        toolsCalling: toSettle,
      });
    }

    const newState = structuredClone(state);
    // Work-registration intents produced by the tool executions, paired with
    // the cumulative cost as of their tool call so the version is inserted ONCE.
    const workRegistrations: ToolWorkRegistration[] = [];
    for (const result of toolResults) {
      if (!result.usageParams) continue;

      const { usage, cost } = UsageCounter.accumulateTool({
        ...result.usageParams,
        cost: newState.cost,
        usage: newState.usage,
      });
      newState.usage = usage;
      if (cost) newState.cost = cost;

      if (result.workRegistration) {
        // Snapshot the running totals as of this tool call so the version is
        // inserted with the right cumulative cost; the writes fire together
        // below (each targets its own sourceToolCallId row).
        workRegistrations.push({
          intent: result.workRegistration,
          sourceMessageId: result.sourceMessageId,
          sourceToolCallId: result.toolCallId,
          sourceToolIdentifier: result.toolCall.identifier,
          sourceToolName: result.toolCall.apiName,
          state: { cost: newState.cost, usage: newState.usage },
        });
      }
    }
    if (workRegistrations.length > 0 && tools.registerWork) {
      await Promise.all(
        workRegistrations.map((registration) => tools.registerWork!(registration, newState)),
      );
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

    // Deferred tools stay out of this: they are alive elsewhere (device /
    // sub-agent) with placeholder rows already written, and cancelling them is
    // a separate concern from settling calls that will never run.
    const pendingTools = aborted ? deferredTools : [...deferredTools, ...clientTools];
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
          // The assistant that emitted this batch — i.e. the previous LLM call.
          // A step is one LLM call, and the batch's tool rows are inline data of
          // that call, so the continuation assistant chains onto the caller and
          // the tools stay its children. Anchoring on a tool row instead makes
          // the spine depend on which tool `Promise.all` happened to settle
          // last, which forks the parent chain and (via the reader's DFS over
          // the parentId forest) strands the other tools after the whole rest of
          // the conversation.
          parentMessageId,
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
