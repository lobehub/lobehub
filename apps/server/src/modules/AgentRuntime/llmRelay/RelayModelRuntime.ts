import type {
  LlmCancelData,
  LlmExecuteData,
  LlmRelayDeadlines,
} from '@lobechat/agent-gateway-client';
import type {
  ChatMethodOptions,
  ChatStreamPayload,
  ModelRuntime,
  ProviderResponseDiagnostics,
} from '@lobechat/model-runtime';
import { createCallbacksTransformer } from '@lobechat/model-runtime';
import type { ModelUsage } from '@lobechat/types';
import debug from 'debug';
import type Redis from 'ioredis';

import { getInvocationDeadline } from '@/server/utils/invocationDeadline';
import { encodeAsync } from '@/utils/tokenizer';

import type { IStreamEventManager } from '../types';
import {
  createClientLlmExecutorLostError,
  createClientLlmExecutorUnavailableError,
  createClientLlmTimeoutError,
} from './errors';
import {
  DEFAULT_LLM_RELAY_DEADLINES,
  fitLlmRelayDeadlines,
  LLM_RELAY_KEY_GRACE_MS,
  llmRelayKeys,
  signLlmRelayLease,
} from './protocol';
import type { RelayDeadline, StoredRelayBatch } from './RelayBatchReader';
import { RelayBatchReader } from './RelayBatchReader';

const log = debug('lobe-server:agent-runtime:llm-relay');

export interface RelayModelRuntimeParams {
  /** Assistant message the attempt streams into, for the client's local rendering. */
  assistantMessageId?: string;
  attempt: number;
  callId: string;
  deadlines?: LlmRelayDeadlines;
  now?: () => number;
  operationId: string;
  preferredClientId?: string;
  provider: string;
  redis: Redis;
  runtimeProvider: string;
  stepIndex: number;
  streamManager: IStreamEventManager;
  userId: string;
}

/** What the attempt learned besides the stream, read back by the transport. */
export interface RelayAttemptResult {
  /** The client reported no usage; the server estimated it. */
  usageEstimated: boolean;
}

const toSseLines = (chunk: StoredRelayBatch['chunks'][number]) => [
  ...(chunk.id ? [`id: ${chunk.id}\n`] : []),
  `event: ${chunk.type}\n`,
  `data: ${JSON.stringify(chunk.data ?? null)}\n\n`,
];

const createAbortError = () => {
  const error = new Error('The relayed LLM attempt was aborted');
  error.name = 'AbortError';
  return error;
};

/**
 * Server half of the LLM relay (T-540 §3.3): same shape as {@link ModelRuntime}
 * for `serverCallLlmAttempt`, but `chat()` does not dial the provider. It
 * stores the request for the user's device, dispatches `llm_execute`, and turns
 * the batches the device uploads back into the normalized protocol stream. The
 * rest of the pipeline — persistence, push, tool-call resolution, usage, the
 * next step — runs unchanged on that stream.
 *
 * Not built through `initModelRuntimeFromDB`, so the cloud billing hooks never
 * see a relayed call: the user's own device paid for it.
 *
 * One instance per attempt: `callId` is the attempt's idempotency key.
 */
export class RelayModelRuntime implements Pick<ModelRuntime, 'chat' | 'handleChatStreamError'> {
  readonly result: RelayAttemptResult = { usageEstimated: false };

  private readonly deadlines: LlmRelayDeadlines;
  private readonly now: () => number;

  constructor(private readonly params: RelayModelRuntimeParams) {
    this.deadlines = fitLlmRelayDeadlines(
      params.deadlines ?? DEFAULT_LLM_RELAY_DEADLINES,
      getInvocationDeadline(),
    );
    this.now = params.now ?? Date.now;
  }

  async chat(payload: ChatStreamPayload, options: ChatMethodOptions = {}): Promise<Response> {
    const { callId, provider, redis } = this.params;
    const dispatchedAt = this.now();
    const ttlMs = this.deadlines.totalMs + LLM_RELAY_KEY_GRACE_MS;

    await redis
      .multi()
      .del(
        llmRelayKeys.bytes(callId),
        llmRelayKeys.cancel(callId),
        llmRelayKeys.lease(callId),
        llmRelayKeys.stream(callId),
      )
      .set(llmRelayKeys.payload(callId), JSON.stringify(payload), 'PX', ttlMs)
      .set(llmRelayKeys.open(callId), this.params.userId, 'PX', ttlMs)
      .exec();

    try {
      await this.dispatch(payload.model, dispatchedAt);
    } catch (error) {
      log('[%s] llm_execute dispatch failed: %O', callId, error);
      await this.cleanup();
      throw createClientLlmExecutorUnavailableError(provider, 'relay_unsupported');
    }

    const reader = new RelayBatchReader(
      redis.duplicate(),
      llmRelayKeys.stream(callId),
      this.deadlines,
      dispatchedAt,
      this.now,
    );

    return new Response(
      this.createStream(reader, payload, options).pipeThrough(
        createCallbacksTransformer(options.callback),
      ),
    );
  }

  /**
   * The provider was never called from here: the device already normalized
   * its error into the uploaded stream. Nothing to sanitize or bill.
   */
  async handleChatStreamError(error: unknown): Promise<void> {
    log('[%s] relayed attempt failed: %O', this.params.callId, error);
  }

  private async dispatch(model: string, dispatchedAt: number) {
    const { params } = this;
    const data: LlmExecuteData = {
      assistantMessageId: params.assistantMessageId,
      attempt: params.attempt,
      callId: params.callId,
      deadlines: this.deadlines,
      leaseToken: signLlmRelayLease({
        callId: params.callId,
        exp: dispatchedAt + this.deadlines.totalMs + LLM_RELAY_KEY_GRACE_MS,
        userId: params.userId,
      }),
      model,
      operationId: params.operationId,
      preferredClientId: params.preferredClientId,
      provider: params.provider,
      runtimeProvider: params.runtimeProvider,
      stepIndex: params.stepIndex,
    };

    await params.streamManager.publishStreamEvent(params.operationId, {
      data,
      stepIndex: params.stepIndex,
      type: 'llm_execute',
    });
  }

  private createStream(
    reader: RelayBatchReader,
    payload: ChatStreamPayload,
    options: ChatMethodOptions,
  ): ReadableStream<string> {
    const { callId, provider } = this.params;
    const signal = options.signal;
    const diagnostics = this.createDiagnostics(options);
    let output = '';
    let sawUsage = false;
    let settled = false;

    const settle = async (cancelReason?: LlmCancelData['reason']) => {
      if (settled) return;
      settled = true;
      if (cancelReason) await this.cancel(cancelReason);
      await this.cleanup(reader);
    };

    return new ReadableStream<string>({
      cancel: async () => {
        await settle('superseded');
      },

      pull: async (controller) => {
        try {
          // A pull that enqueues nothing is not pulled again, so read past
          // heartbeat batches here — returning on one would stall the stream
          // and its deadlines with it.
          for (;;) {
            const next = await reader.next(signal);

            if (next.kind === 'aborted') {
              diagnostics.aborted = true;
              await settle('interrupted');
              return controller.error(createAbortError());
            }

            if (next.kind === 'timeout') {
              log('[%s] relay deadline missed: %s', callId, next.which);
              await settle('timeout');
              return controller.error(this.toDeadlineError(next.which));
            }

            const { batch } = next;
            for (const chunk of batch.chunks) {
              diagnostics.eventCount += 1;
              diagnostics.eventCounts[chunk.type] = (diagnostics.eventCounts[chunk.type] ?? 0) + 1;
              diagnostics.firstEventAt ??= this.now();
              if (chunk.type === 'usage') sawUsage = true;
              if (
                (chunk.type === 'text' || chunk.type === 'reasoning') &&
                typeof chunk.data === 'string'
              )
                output += chunk.data;

              for (const line of toSseLines(chunk)) controller.enqueue(line);
            }

            if (!batch.final) {
              if (batch.chunks.length > 0) return;
              continue;
            }

            diagnostics.terminalEventReceived = true;
            switch (batch.final.reason) {
              case 'done': {
                if (!sawUsage) {
                  const usage = await estimateUsage(payload, output);
                  this.result.usageEstimated = true;
                  for (const line of toSseLines({ data: usage, type: 'usage' }))
                    controller.enqueue(line);
                }
                await settle();
                return controller.close();
              }
              case 'error': {
                // The device's provider failed: hand its normalized error to the
                // pipeline like any provider stream error, so the retry policy
                // classifies it by its own error type.
                const error = batch.final.error ?? { message: 'The relayed LLM attempt failed' };
                for (const line of toSseLines({ data: error, type: 'error' }))
                  controller.enqueue(line);
                await settle();
                return controller.close();
              }
              default: {
                // The client ended the attempt without the server asking.
                if (signal?.aborted) {
                  diagnostics.aborted = true;
                  await settle();
                  return controller.error(createAbortError());
                }
                await settle();
                return controller.error(
                  createClientLlmExecutorLostError(provider, 'client_aborted'),
                );
              }
            }
          }
        } catch (error) {
          await settle('error');
          controller.error(error);
        }
      },
    });
  }

  private toDeadlineError(which: RelayDeadline) {
    const { provider } = this.params;
    switch (which) {
      case 'claim': {
        return createClientLlmExecutorUnavailableError(provider, 'claim_timeout');
      }
      case 'first_chunk': {
        return createClientLlmTimeoutError(provider, 'first_chunk');
      }
      case 'total': {
        return createClientLlmTimeoutError(provider, 'total');
      }
      default: {
        return createClientLlmExecutorLostError(provider, which);
      }
    }
  }

  /**
   * Tell the executor to stop: the flag answers its next upload with
   * `cancel: true`, the event reaches it while it is between uploads.
   */
  private async cancel(reason: LlmCancelData['reason']) {
    const { callId, operationId, redis, stepIndex, streamManager } = this.params;
    try {
      await redis.set(
        llmRelayKeys.cancel(callId),
        reason,
        'PX',
        this.deadlines.totalMs + LLM_RELAY_KEY_GRACE_MS,
      );
      const data: LlmCancelData = { callId, reason };
      await streamManager.publishStreamEvent(operationId, { data, stepIndex, type: 'llm_cancel' });
    } catch (error) {
      log('[%s] failed to cancel the relayed attempt: %O', callId, error);
    }
  }

  /** Close the call: late uploads find no open call and get `410`. */
  private async cleanup(reader?: RelayBatchReader) {
    const { callId, redis } = this.params;
    try {
      await redis
        .multi()
        .del(llmRelayKeys.open(callId), llmRelayKeys.payload(callId))
        .pexpire(llmRelayKeys.stream(callId), LLM_RELAY_KEY_GRACE_MS)
        .exec();
    } catch (error) {
      log('[%s] failed to clean up relay keys: %O', callId, error);
    }
    reader?.close();
  }

  private createDiagnostics(options: ChatMethodOptions): ProviderResponseDiagnostics {
    const diagnostics: ProviderResponseDiagnostics = {
      apiMode: 'llm_relay',
      droppedEventCount: 0,
      eventCount: 0,
      eventCounts: {},
      events: [],
      hasNonWhitespaceText: false,
      hasNonWhitespaceThinking: false,
      rawEvents: [],
      signatureChars: 0,
      terminalEventReceived: false,
      textChars: 0,
      thinkingChars: 0,
      toolInputChars: 0,
      toolUseCount: 0,
    };
    if (options.diagnostics) options.diagnostics.providerResponse = diagnostics;
    return diagnostics;
  }
}

/**
 * Usage for a client that reported none (U4f): some OpenAI-compatible local
 * servers ignore `stream_options.include_usage`. Rough token counts of the
 * request messages and the streamed text; flagged as estimated on the message.
 */
const estimateUsage = async (payload: ChatStreamPayload, output: string): Promise<ModelUsage> => {
  const inputTokens = await encodeAsync(JSON.stringify(payload.messages ?? []));
  const outputTokens = await encodeAsync(output);

  return {
    inputTextTokens: inputTokens,
    outputTextTokens: outputTokens,
    totalInputTokens: inputTokens,
    totalOutputTokens: outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
};
