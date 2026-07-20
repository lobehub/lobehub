import type {
  AgentRuntimeHost,
  ContextBuildOutput,
  LLMAttemptOutput,
  LLMRetryPolicy,
  LLMTrace,
  LLMTransport,
} from '../transport';
import type {
  AgentEvent,
  AgentInstruction,
  AgentState,
  CallLLMPayload,
  InstructionExecutor,
} from '../types';
import { getLLMRetryDelayMs, shouldRetryLLM } from '../utils/runtimeRetry';
import { finalizeCallLlmTurn, persistInterruptedCallLlmResult } from './callLlmFinalizer';

const CONVERSATION_PARENT_MISSING_ERROR_TYPE = 'ConversationParentMissing';

interface LLMCallTransport {
  retryPolicy: LLMRetryPolicy;
  runAttempt: NonNullable<LLMTransport['runAttempt']>;
}

interface PreparedCallLlmInput {
  assistantMessageId: string;
  context: ContextBuildOutput;
  model: string;
  provider: string;
  state: AgentState;
  stepLabel?: string;
}

const requireLLMCallTransport = (host: AgentRuntimeHost) => {
  const llm = host.transports.llm;
  if (!llm?.runAttempt) {
    throw new Error('LLMTransport.runAttempt is required for call_llm executor');
  }
  if (!llm.retryPolicy) {
    throw new Error('LLMTransport.retryPolicy is required for call_llm executor');
  }
  return llm as NonNullable<AgentRuntimeHost['transports']['llm']> & LLMCallTransport;
};

const waitForRetry = (delayMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });

const isOperationInterrupted = async (host: AgentRuntimeHost) => {
  const operationStore = host.transports.operationStore;
  if (!operationStore?.loadState) return false;

  try {
    const latestState = await operationStore.loadState(host.operation.operationId);
    return latestState?.status === 'interrupted';
  } catch (error) {
    console.error('[call_llm] Failed to load operation state for retry guard:', error);
    return false;
  }
};

const runWithTrace = <T>(trace: LLMTrace | undefined, task: () => Promise<T>) =>
  trace ? trace.run(task) : task();

const executePreparedCall = async (
  host: AgentRuntimeHost,
  llm: LLMCallTransport,
  prepared: PreparedCallLlmInput,
  trace?: LLMTrace,
) => {
  const events: AgentEvent[] = [];
  const { retryPolicy } = llm;
  const maxAttempts = retryPolicy.maxAttempts(prepared.provider);
  let errorHandled = false;
  let lastOutput: LLMAttemptOutput | undefined;
  let terminalError: unknown;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const execution = await runWithTrace(trace, () =>
        llm.runAttempt({
          attempt,
          context: prepared.context,
          events,
          maxAttempts,
          model: prepared.model,
          onFirstChunk: trace?.onFirstChunk.bind(trace),
          provider: prepared.provider,
          state: prepared.state,
        }),
      );
      lastOutput = execution.output;

      if (execution.ok) {
        return await finalizeCallLlmTurn({
          assistantMessageId: prepared.assistantMessageId,
          events,
          host,
          model: prepared.model,
          output: execution.output,
          provider: prepared.provider,
          recordResult: trace?.recordResult?.bind(trace),
          shouldReplayAssistantReasoning: prepared.context.replayAssistantReasoning,
          state: prepared.state,
          stepLabel: prepared.stepLabel,
        });
      }

      const { error } = execution;
      const classified = retryPolicy.classifyError(error);
      const retryBudget = retryPolicy.resolveRetryBudget(prepared.provider, error);
      let interrupted = await isOperationInterrupted(host);

      if (!interrupted && shouldRetryLLM(classified.kind, attempt, retryBudget)) {
        const delayMs = getLLMRetryDelayMs(attempt);
        const retryEvent: AgentEvent = {
          data: {
            attempt: attempt + 1,
            delayMs,
            errorType: classified.code,
            kind: classified.kind,
            maxAttempts,
          },
          type: 'stream_retry',
        };
        events.push(retryEvent);

        await retryPolicy.onRetry?.({
          attempt,
          delayMs,
          error: classified,
          maxAttempts,
        });
        await host.transports.stream.publishEvent({
          data: retryEvent.data,
          stepIndex: host.operation.stepIndex,
          type: 'stream_retry',
        });
        await (retryPolicy.waitForRetry ?? waitForRetry)(delayMs);

        interrupted = await isOperationInterrupted(host);
        if (!interrupted) continue;
      }

      errorHandled = true;
      if (interrupted) {
        await persistInterruptedCallLlmResult({
          assistantMessageId: prepared.assistantMessageId,
          host,
          output: execution.output,
        });
      }
      await runWithTrace(trace, async () => {
        await retryPolicy.onError?.({
          error,
          events,
          interrupted,
          output: execution.output,
          retryBudget,
        });
      });
      throw error;
    }

    throw new Error('LLM execution retry loop exited unexpectedly');
  } catch (error) {
    terminalError = error;
    if (!errorHandled) {
      const interrupted = await isOperationInterrupted(host);
      if (interrupted && lastOutput) {
        await persistInterruptedCallLlmResult({
          assistantMessageId: prepared.assistantMessageId,
          host,
          output: lastOutput,
        });
      }
      await runWithTrace(trace, async () => {
        await retryPolicy.onError?.({
          error,
          events,
          interrupted,
          output: lastOutput,
        });
      });
    }
    throw error;
  } finally {
    await trace?.close(terminalError);
  }
};

const requireContextBuilder = (host: AgentRuntimeHost) => {
  const context = host.transports.context;
  if (!context) {
    throw new Error('ContextBuilder is required for call_llm executor');
  }
  return context;
};

const assertPreparedCallContext = (
  prepared: Pick<PreparedCallLlmInput, 'context' | 'model' | 'provider' | 'state'>,
  stepIndex: number,
) => {
  if (!prepared.context.resolvedTools) {
    throw new Error('Resolved tools are required for call_llm');
  }

  const messages = prepared.context.messages as Array<{ role?: string }>;
  if (!messages.some((message) => message.role !== 'system')) {
    throw new Error(
      `call_llm produced no non-system messages for ${prepared.provider}/${prepared.model} ` +
        `(topic=${prepared.state.metadata?.topicId ?? 'n/a'}, step=${stepIndex}); refusing to dispatch`,
    );
  }
};

const createConversationParentMissingError = (parentId: string) => {
  const error = new Error(
    `Conversation parent message ${parentId} no longer exists. It was likely deleted while the operation was running.`,
  );
  Object.assign(error, {
    errorType: CONVERSATION_PARENT_MISSING_ERROR_TYPE,
    parentId,
  });
  return error;
};

const formatErrorEventData = (error: Error & { errorType?: unknown }, phase: string) => ({
  error: error.message,
  errorType: typeof error.errorType === 'string' ? error.errorType : error.name,
  phase,
});

const pickSeedField = (source: object, key: string) => {
  const value = (source as Record<string, unknown>)[key];
  return value === undefined ? undefined : value;
};

const buildAssistantMessageSeed = (
  assistantMessage: { id: string },
  seed: object = assistantMessage,
) => ({
  id: assistantMessage.id,
  ...(pickSeedField(seed, 'agentId') !== undefined && {
    agentId: pickSeedField(seed, 'agentId'),
  }),
  ...(pickSeedField(seed, 'groupId') !== undefined && {
    groupId: pickSeedField(seed, 'groupId'),
  }),
  ...(pickSeedField(seed, 'model') !== undefined && { model: pickSeedField(seed, 'model') }),
  ...(pickSeedField(seed, 'parentId') !== undefined && {
    parentId: pickSeedField(seed, 'parentId'),
  }),
  ...(pickSeedField(seed, 'provider') !== undefined && {
    provider: pickSeedField(seed, 'provider'),
  }),
  ...(pickSeedField(seed, 'role') !== undefined && { role: pickSeedField(seed, 'role') }),
  ...(pickSeedField(seed, 'threadId') !== undefined && {
    threadId: pickSeedField(seed, 'threadId'),
  }),
  ...(pickSeedField(seed, 'topicId') !== undefined && {
    topicId: pickSeedField(seed, 'topicId'),
  }),
});

/**
 * Package-owned `call_llm` executor entry point.
 *
 * The package prepares and finalizes the turn, including retry, interruption,
 * persistence, and state updates. The host-bound session retains provider
 * policy, model attempt execution, and tracing hooks.
 */
export const callLlm =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { operation, transports } = host;
    const contextBuilder = requireContextBuilder(host);
    const llm = requireLLMCallTransport(host);
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_llm' }>;
    const llmPayload = payload as CallLLMPayload & {
      assistantMessageId?: string;
      parentMessageId?: string;
    };
    const model = llmPayload.model || state.modelRuntimeConfig?.model;
    const provider = llmPayload.provider || state.modelRuntimeConfig?.provider;

    if (!model || !provider) {
      throw new Error('Model and provider are required for call_llm instruction');
    }

    const parentId = llmPayload.parentId || llmPayload.parentMessageId;
    if (parentId) {
      const parentExists = await transports.messages.findById(parentId);
      if (!parentExists) {
        const error = createConversationParentMissingError(parentId);
        await transports.stream.publishEvent({
          data: formatErrorEventData(error, 'parent_message_preflight'),
          stepIndex: operation.stepIndex,
          type: 'error',
        });
        throw error;
      }
    }

    const existingAssistantMessageId = llmPayload.assistantMessageId;
    const assistantMessage = existingAssistantMessageId
      ? { id: existingAssistantMessageId }
      : await transports.messages.createAssistantMessage({
          agentId: state.metadata!.agentId!,
          content: '',
          groupId: state.metadata?.groupId ?? undefined,
          model,
          parentId,
          provider,
          role: 'assistant',
          threadId: state.metadata?.threadId,
          topicId: state.metadata?.topicId,
        });

    const assistantMessageSeed = existingAssistantMessageId
      ? ((await transports.messages.findById(existingAssistantMessageId)) ?? assistantMessage)
      : assistantMessage;
    const stepLabel = (instruction as { stepLabel?: string }).stepLabel;

    await transports.stream.publishEvent({
      data: {
        assistantMessage: buildAssistantMessageSeed(assistantMessage, assistantMessageSeed),
        model,
        provider,
        ...(stepLabel && { stepLabel }),
      },
      stepIndex: operation.stepIndex,
      type: 'stream_start',
    });

    const context = await contextBuilder
      .build({
        model,
        payload: llmPayload,
        provider,
        state,
      })
      .catch(async (error) => {
        await transports.stream.publishError?.({
          error,
          phase: 'llm_execution',
          stepIndex: operation.stepIndex,
        });
        throw error;
      });

    try {
      const prepared: PreparedCallLlmInput = {
        assistantMessageId: assistantMessage.id,
        context,
        model,
        provider,
        state,
        stepLabel,
      };
      assertPreparedCallContext(prepared, operation.stepIndex);
      const trace = llm.createTrace?.({
        assistantMessageId: assistantMessage.id,
        conversationId: state.metadata?.topicId,
        model,
        provider,
      });
      return await executePreparedCall(host, llm, prepared, trace);
    } catch (error) {
      await transports.stream.publishError?.({
        error,
        phase: 'llm_execution',
        stepIndex: operation.stepIndex,
      });
      throw error;
    }
  };
