import type { ModelUsage } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

import {
  isEmptyModelCompletion,
  isModelRefusalFinishReason,
  ModelEmptyError,
  ModelRefusalError,
} from '../../errors';
import type { ChatMethodOptions, ChatStreamCallbacks, OnFinishData } from '../../types';
import type { ModelRuntimeDiagnostics } from '../../types/providerDiagnostics';
import { AgentRuntimeError } from '../../utils/createError';
import type { RouteAttemptFinished, RouteAttemptOutcome, RouteAttemptStart } from './routeAttempt';

export type { RouteAttemptFinished, RouteAttemptOutcome, RouteAttemptStart } from './routeAttempt';

export interface ChatAttemptObservation {
  commit: () => Promise<void>;
  discard: () => void;
  finished: Promise<RouteAttemptFinished>;
  hasVisibleOutput: () => boolean;
}

const observations = new WeakMap<Response, ChatAttemptObservation>();

export const getChatAttemptObservation = (response: Response): ChatAttemptObservation | undefined =>
  observations.get(response);

const getReasoningContent = (data: OnFinishData | undefined) =>
  data?.thinking ?? data?.reasoning?.content ?? '';

const createStreamChunkError = (error: unknown, provider: string) =>
  Object.assign(
    new Error(error instanceof Error ? error.message : String(error), { cause: error }),
    AgentRuntimeError.chat({
      error: {
        cause: error,
        message: error instanceof Error ? error.message : String(error),
        name: 'StreamChunkError',
      },
      errorType: AgentRuntimeErrorType.StreamChunkError,
      provider,
    }),
    { name: 'StreamChunkError' },
  );

/**
 * Observe the actual response body lifecycle. Terminal callbacks are delayed until
 * EOF so an upstream disconnect after `onFinal` cannot be reported as completed.
 * Optional callback deferral lets the router discard an uncommitted attempt before
 * switching to a fallback channel.
 */
export const observeChatAttempt = async (
  request: (options: ChatMethodOptions) => Promise<Response>,
  options: ChatMethodOptions | undefined,
  attempt: RouteAttemptStart,
  streaming: boolean,
  onFinished: (result: RouteAttemptFinished) => Promise<void> | void,
  observerOptions?: { deferCallbacks?: boolean },
): Promise<Response> => {
  const attemptDiagnostics: ModelRuntimeDiagnostics = {};
  let committed = !observerOptions?.deferCallbacks;
  let discarded = false;
  let durationMs: number | undefined;
  let finalResult: RouteAttemptFinished | undefined;
  let observedUsage: ModelUsage | undefined;
  let streamError: unknown;
  let visibleOutput = false;
  let imageCount = 0;
  let toolCallCount = 0;
  let grounding: unknown;
  let content = '';
  let reasoning = '';
  let latestFinishData: OnFinishData | undefined;
  let receivedFinalCallback = false;
  const pendingCallbacks: Array<() => Promise<void>> = [];
  const terminalCallbacks: Array<{
    callback: ((data: OnFinishData) => Promise<void> | void) | undefined;
    data: OnFinishData;
  }> = [];
  let resolveFinished!: (result: RouteAttemptFinished) => void;
  const finished = new Promise<RouteAttemptFinished>((resolve) => {
    resolveFinished = resolve;
  });
  const callback = options?.callback;

  const publishAttemptDiagnostics = () => {
    if (!options?.diagnostics) return;

    options.diagnostics.providerRequest = attemptDiagnostics.providerRequest;
    options.diagnostics.providerResponse = attemptDiagnostics.providerResponse;
  };

  const runOrBuffer = async (callbackTask: () => Promise<void>) => {
    if (discarded) return;
    if (committed) await callbackTask();
    else pendingCallbacks.push(callbackTask);
  };

  const flushTerminalCallbacks = async () => {
    if (!committed || discarded || !finalResult) return;

    for (const terminal of terminalCallbacks.splice(0)) {
      if (!terminal.callback) continue;
      await terminal.callback({
        ...terminal.data,
        routeAttempt: {
          attemptId: attempt.attemptId,
          outcome: finalResult.outcome,
          requestId: attempt.requestId,
        },
        speed: finalResult.speed ? { ...finalResult.speed } : undefined,
      });
    }
  };

  const commit = async () => {
    if (discarded) return;
    if (!committed) {
      committed = true;
      for (const callbackTask of pendingCallbacks.splice(0)) await callbackTask();
    }
    publishAttemptDiagnostics();
    await flushTerminalCallbacks();
  };

  const discard = () => {
    discarded = true;
    pendingCallbacks.length = 0;
    terminalCallbacks.length = 0;
  };

  const report = async (result: RouteAttemptFinished) => {
    try {
      await onFinished(result);
    } catch (error) {
      // Observability failures must never retry a provider call or suppress its output.
      console.error('[RouterRuntime] Failed to report attempt completion:', error);
    }
  };

  const finish = async (outcome: RouteAttemptOutcome, error?: unknown) => {
    if (finalResult) return finalResult;

    const finishData = latestFinishData;
    const completedAt = Date.now();
    const usage =
      finishData?.usage || observedUsage ? { ...observedUsage, ...finishData?.usage } : undefined;
    const finalError = error ?? streamError ?? finishData?.error;
    if (outcome !== 'failed' && !receivedFinalCallback) {
      terminalCallbacks.push({
        callback: callback?.onFinal,
        data: {
          error: finalError,
          finishReason: outcome === 'cancelled' ? 'abort' : finishData?.finishReason,
          grounding: finishData?.grounding ?? grounding,
          reasoning: finishData?.reasoning,
          text: finishData?.text ?? content,
          thinking: finishData?.thinking ?? reasoning,
          toolsCalling: finishData?.toolsCalling,
          usage,
          usageMissingDiagnostics: finishData?.usageMissingDiagnostics,
        },
      });
    }
    finalResult = {
      ...attempt,
      completedAt,
      diagnostics: attemptDiagnostics,
      durationMs: durationMs ?? completedAt - attempt.startedAt,
      error: finalError,
      outcome,
      speed: finishData?.speed
        ? {
            ...finishData.speed,
            ...(outcome !== 'completed' && { tps: undefined }),
          }
        : undefined,
      streaming,
      success: outcome === 'completed',
      usage,
    };
    options?.signal?.removeEventListener('abort', onAbort);
    resolveFinished(finalResult);
    void report(finalResult);
    await flushTerminalCallbacks();
    return finalResult;
  };

  const finishFromEOF = async () => {
    if (finalResult) return finalResult;
    if (options?.signal?.aborted || latestFinishData?.finishReason === 'abort') {
      return finish('cancelled');
    }
    if (latestFinishData?.error || streamError) {
      const error = streamError ?? latestFinishData?.error;
      return finish(
        'interrupted',
        visibleOutput ? createStreamChunkError(error, attempt.providerId) : error,
      );
    }
    // JSON-mode responses do not emit stream callbacks; reaching body EOF is their terminal success.
    if (!latestFinishData) return finish(streaming ? 'interrupted' : 'completed');

    const finalContent = content || latestFinishData.text;
    const finalReasoning = reasoning || getReasoningContent(latestFinishData);
    const finalToolCallCount = Math.max(latestFinishData.toolsCalling?.length ?? 0, toolCallCount);
    const empty = isEmptyModelCompletion({
      content: finalContent,
      hasGrounding: Boolean(latestFinishData.grounding ?? grounding),
      imageCount,
      outputTokens: latestFinishData.usage?.totalOutputTokens ?? observedUsage?.totalOutputTokens,
      reasoning: finalReasoning,
      toolCallCount: finalToolCallCount,
    });

    if (!empty) return finish('completed');

    const diagnostics = {
      contentLength: finalContent.length,
      cost: latestFinishData.usage?.cost,
      finishReason: latestFinishData.finishReason,
      imageCount,
      model: attempt.model,
      outputTokens: latestFinishData.usage?.totalOutputTokens ?? observedUsage?.totalOutputTokens,
      provider: attempt.providerId,
      reasoningLength: finalReasoning.length,
      toolCallCount: finalToolCallCount,
    };

    /**
     * A blank turn stopped by a provider refusal or moderation finish reason (e.g. Anthropic
     * `refusal`, GLM `sensitive`) is a policy decision, not a provider malfunction. Keep the
     * `empty` outcome for route metrics, but surface the refusal so callers can show a
     * policy-specific message instead of the generic empty-completion error.
     */
    return finish(
      'empty',
      isModelRefusalFinishReason(latestFinishData.finishReason)
        ? new ModelRefusalError(undefined, diagnostics)
        : new ModelEmptyError(undefined, diagnostics),
    );
  };

  const onAbort = () => {
    void finish('cancelled');
  };
  options?.signal?.addEventListener('abort', onAbort, { once: true });

  const terminalCallback = (
    terminal: ((data: OnFinishData) => Promise<void> | void) | undefined,
    data: OnFinishData,
  ) => {
    latestFinishData = data;
    if (data.usage) observedUsage = { ...observedUsage, ...data.usage };
    toolCallCount = Math.max(toolCallCount, data.toolsCalling?.length ?? 0);
    grounding ??= data.grounding;
    if (
      data.text.trim() ||
      getReasoningContent(data).trim() ||
      (data.toolsCalling?.length ?? 0) > 0
    ) {
      visibleOutput = true;
    }
    terminalCallbacks.push({ callback: terminal, data });
  };

  const observedCallbacks: ChatStreamCallbacks = {
    ...callback,
    onBase64Image: async (data) => {
      imageCount = Math.max(imageCount, data.images.length);
      visibleOutput = true;
      await runOrBuffer(async () => {
        await callback?.onBase64Image?.(data);
      });
    },
    onCompletion: async (data) => {
      terminalCallback(callback?.onCompletion, data);
    },
    onContentPart: async (data) => {
      if (data.partType === 'image') imageCount += 1;
      else content += data.content;
      if (data.partType === 'image' || data.content.trim()) visibleOutput = true;
      await runOrBuffer(async () => {
        await callback?.onContentPart?.(data);
      });
    },
    onError: async (error) => {
      streamError = error;
      await runOrBuffer(async () => {
        await callback?.onError?.(error);
      });
    },
    onFinal: async (data) => {
      receivedFinalCallback = true;
      terminalCallback(callback?.onFinal, data);
    },
    onGrounding: async (data) => {
      grounding = data;
      await runOrBuffer(async () => {
        await callback?.onGrounding?.(data);
      });
    },
    onReasoningPart: async (data) => {
      if (data.partType === 'image') imageCount += 1;
      else reasoning += data.content;
      if (data.partType === 'image' || data.content.trim()) visibleOutput = true;
      await runOrBuffer(async () => {
        await callback?.onReasoningPart?.(data);
      });
    },
    onStart: async () => {
      await runOrBuffer(async () => {
        await callback?.onStart?.();
      });
    },
    onText: async (text) => {
      content += text;
      if (text.trim()) visibleOutput = true;
      await runOrBuffer(async () => {
        await callback?.onText?.(text);
      });
    },
    onThinking: async (text) => {
      reasoning += text;
      if (text.trim()) visibleOutput = true;
      await runOrBuffer(async () => {
        await callback?.onThinking?.(text);
      });
    },
    onToolsCalling: async (data) => {
      toolCallCount = Math.max(toolCallCount, data.toolsCalling.length, data.chunk.length);
      if (toolCallCount > 0) visibleOutput = true;
      await runOrBuffer(async () => {
        await callback?.onToolsCalling?.(data);
      });
    },
    onUsage: async (usage) => {
      observedUsage = { ...observedUsage, ...usage };
      await runOrBuffer(async () => {
        await callback?.onUsage?.(usage);
      });
    },
  };

  try {
    if (options?.signal?.aborted) options.signal.throwIfAborted();
    const response = await request({
      ...options,
      callback: observedCallbacks,
      diagnostics: attemptDiagnostics,
    });
    durationMs = Date.now() - attempt.startedAt;

    const observation: ChatAttemptObservation = {
      commit,
      discard,
      finished,
      hasVisibleOutput: () => visibleOutput,
    };
    observations.set(response, observation);

    if (!response.body) {
      const result = await finishFromEOF();
      if (result.outcome === 'empty' && !observerOptions?.deferCallbacks) throw result.error;
      return response;
    }

    const reader = response.body.getReader();
    const observedResponse = new Response(
      new ReadableStream<Uint8Array>(
        {
          async cancel(reason) {
            await finish('cancelled');
            if (!observerOptions?.deferCallbacks) await commit();
            await reader.cancel(reason);
          },
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (!done) {
                controller.enqueue(value);
                return;
              }

              const result = await finishFromEOF();
              if (!observerOptions?.deferCallbacks) await commit();
              if (result.outcome === 'empty') controller.error(result.error);
              else controller.close();
            } catch (error) {
              const result = await finish(
                options?.signal?.aborted ? 'cancelled' : 'interrupted',
                error,
              );
              if (!observerOptions?.deferCallbacks) await commit();
              controller.error(
                visibleOutput && result.outcome !== 'cancelled'
                  ? createStreamChunkError(error, attempt.providerId)
                  : error,
              );
            }
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: response.headers, status: response.status, statusText: response.statusText },
    );
    observations.set(observedResponse, observation);
    return observedResponse;
  } catch (error) {
    durationMs = Date.now() - attempt.startedAt;
    const result = await finish(options?.signal?.aborted ? 'cancelled' : 'failed', error);
    if (observerOptions?.deferCallbacks) discard();
    else await commit();
    throw result.error ?? error;
  }
};
