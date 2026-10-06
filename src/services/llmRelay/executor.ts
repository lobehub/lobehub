import type { LlmCancelData, LlmExecuteData, LlmRelayBatch } from '@lobechat/agent-gateway-client';
import { LLM_RELAY_LEASE_HEADER } from '@lobechat/agent-gateway-client';
import debug from 'debug';

import type { RelayUploadRejection } from './batchUploader';
import { RelayBatchUploader } from './batchUploader';
import { getLlmRelayClientId } from './clientId';
import type { RelayProtocolChunk } from './protocolChunks';
import { readProtocolChunks } from './protocolChunks';

const log = debug('lobe-client:llm-relay');

/**
 * A client that did not start the run gives the starter this long to claim the
 * call first. Only matters where the gateway broadcasts `llm_execute` (older
 * gateways, the self-hosted Go gateway); the claim deadline is 15 s.
 */
export const NON_PREFERRED_CLAIM_DELAY_MS = 3000;

/** Call ids remembered after they settle, to drop replays and late echoes. */
const SETTLED_CALL_MEMORY = 200;

export interface RelayRuntime {
  chat: (payload: any, options: { signal?: AbortSignal }) => Promise<Response>;
  generateObject?: (payload: any, options: { signal?: AbortSignal }) => Promise<unknown>;
  models?: () => Promise<unknown>;
  pullModel?: (params: any, options: { signal?: AbortSignal }) => Promise<Response | undefined>;
}

/** A return value goes up as JSON text in parts of this size, well under the batch cap. */
const RESULT_PART_CHARS = 32 * 1024;

export interface LlmRelayExecutorDeps {
  clientId?: () => string;
  /** Build the model runtime from this client's own provider configuration. */
  createRuntime: (options: {
    payload: Record<string, unknown>;
    provider: string;
    runtimeProvider: string;
  }) => Promise<RelayRuntime>;
  fetch?: typeof fetch;
  serverBaseUrl?: string;
}

export interface ExecuteRelayCallOptions {
  /**
   * Each protocol chunk this client produces for the call, as soon as it is
   * produced — for rendering the reply locally before the server's echo.
   * Only called once this client owns the call.
   */
  onOutput?: (chunk: RelayProtocolChunk) => void;
}

type StopReason = LlmCancelData['reason'] | 'deadline' | 'operation_ended' | RelayUploadRejection;

interface ActiveCall {
  controller: AbortController;
  operationId: string;
  owned: boolean;
  stop: (reason: StopReason) => void;
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** JSON-safe error for the final batch; the server keys its retry policy off `errorType`. */
const toRelayError = (error: unknown, provider: string) => {
  if (error && typeof error === 'object' && 'errorType' in error) {
    const { error: inner, ...rest } = error as Record<string, unknown>;
    const detail =
      inner instanceof Error ? { message: inner.message, name: inner.name } : (inner ?? undefined);
    // Not a clone: a JSON round trip drops what the upload cannot carry
    // (functions, undefined), where structuredClone would throw.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    return JSON.parse(JSON.stringify({ provider, ...rest, error: detail }));
  }

  const message = error instanceof Error ? error.message : String(error);
  return { error: { message }, errorType: 'ProviderBizError', message, provider };
};

/**
 * `promise`, or an abort error once `signal` aborts — for provider calls that
 * take no signal (`models`) and may never answer.
 */
const untilAborted = <T>(promise: Promise<T>, signal: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
    promise.then(resolve, reject);
  });

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });

/**
 * Client executor of the LLM relay (T-540 §3, PR 4): when the server hands
 * this client one LLM attempt (`llm_execute`) for a provider only this device
 * can reach, run it with the client's own provider configuration and stream
 * the normalized protocol chunks back in batches.
 *
 * 1. claim the call with an empty batch (the first claimant wins, others `409`)
 * 2. fetch the request body (`GET …/payload`) — it never rides the socket
 * 3. `ModelRuntime.chat()` locally, upload every protocol chunk, and hand it
 *    to `onOutput` for local rendering
 * 4. end with a `final` batch: `done`, `error` (the provider's own error, so
 *    the server's retry policy classifies it) or `aborted`
 *
 * `llm_cancel`, a `cancel` ack, a `409`/`410`, or the total deadline stop the
 * local model request immediately.
 */
export class LlmRelayExecutor {
  private readonly active = new Map<string, ActiveCall>();
  /** Calls this client claimed, kept after they settle for echo dedupe. */
  private readonly owned = new Set<string>();
  private readonly settled = new Set<string>();

  constructor(private readonly deps: LlmRelayExecutorDeps) {}

  /** Whether this client executed (and rendered) the call — its server echo is redundant. */
  ownsCall(callId: string | undefined): boolean {
    return !!callId && this.owned.has(callId);
  }

  isRunning(callId: string) {
    return this.active.has(callId);
  }

  cancel({ callId, reason }: Pick<LlmCancelData, 'callId' | 'reason'>) {
    this.active.get(callId)?.stop(reason);
  }

  /**
   * The run ended (stopped, failed, finished): drop its in-flight attempts.
   * Its `llm_cancel` can trail the terminal event, which closes the session
   * that would deliver it. Nothing more is uploaded — the server has already
   * settled the step, and a late `aborted` batch must not look like a lost
   * executor.
   */
  cancelOperation(operationId: string) {
    for (const call of this.active.values()) {
      if (call.operationId === operationId) call.stop('operation_ended');
    }
  }

  async execute(data: LlmExecuteData, options: ExecuteRelayCallOptions = {}): Promise<void> {
    const { callId } = data;
    // Replays (gateway resume, a re-subscribe) re-deliver the same call id.
    if (this.active.has(callId) || this.settled.has(callId)) return;

    const clientId = (this.deps.clientId ?? getLlmRelayClientId)();
    const controller = new AbortController();
    let stopReason: StopReason | undefined;

    const call: ActiveCall = {
      controller,
      operationId: data.operationId,
      owned: false,
      stop: (reason) => {
        if (controller.signal.aborted) return;
        stopReason = reason;
        controller.abort();
        // A claim still in flight is abandoned; an owned call keeps its
        // uploader to send the final `aborted` batch.
        if (!call.owned) uploader.dispose();
      },
    };
    this.active.set(callId, call);

    const uploader = new RelayBatchUploader({
      callId,
      clientId,
      fetch: this.deps.fetch,
      leaseToken: data.leaseToken,
      onRejected: (reason) => call.stop(reason),
      serverBaseUrl: this.deps.serverBaseUrl,
    });

    // Stop a little before the server's own total deadline would.
    const deadline = setTimeout(
      () => call.stop('deadline'),
      Math.max(data.deadlines.totalMs - 5000, 1000),
    );

    try {
      if (data.preferredClientId && data.preferredClientId !== clientId) {
        await sleep(NON_PREFERRED_CLAIM_DELAY_MS, controller.signal);
      }

      if (!(await uploader.claim())) {
        log('[%s] not claimed: %s', callId, uploader.rejection);
        return;
      }
      call.owned = true;
      this.owned.add(callId);
      log('[%s] claimed by %s', callId, clientId);

      const final = await this.run(data, uploader, controller.signal, options);
      if (!uploader.rejection) await uploader.finish(final);
    } catch (error) {
      if (!controller.signal.aborted) {
        log('[%s] relay attempt failed before streaming: %O', callId, error);
        await uploader.finish({ error: toRelayError(error, data.provider), reason: 'error' });
      }
    } finally {
      clearTimeout(deadline);
      if (
        controller.signal.aborted &&
        call.owned &&
        !uploader.rejection &&
        stopReason !== 'operation_ended'
      ) {
        // Stopped by `llm_cancel` or the local deadline: tell the server the
        // attempt ended here, so it does not wait for the idle deadline.
        await uploader.finish({ reason: 'aborted' });
      }
      uploader.dispose();
      this.active.delete(callId);
      this.remember(callId);
      log('[%s] settled (stop=%s)', callId, stopReason ?? 'none');
    }
  }

  private async run(
    data: LlmExecuteData,
    uploader: RelayBatchUploader,
    signal: AbortSignal,
    { onOutput }: ExecuteRelayCallOptions,
  ): Promise<NonNullable<LlmRelayBatch['final']>> {
    const payload = await this.fetchPayload(data, signal);

    let response: Response;
    try {
      const runtime = await this.deps.createRuntime({
        payload,
        provider: data.provider,
        runtimeProvider: data.runtimeProvider,
      });
      const method = data.method ?? 'chat';
      if (method !== 'chat')
        return await this.runMethod(method, runtime, payload, uploader, signal);
      response = await runtime.chat(payload, { signal });
    } catch (error) {
      if (signal.aborted) throw error;
      return { error: toRelayError(error, data.provider), reason: 'error' };
    }

    if (!response.body) {
      return {
        error: toRelayError(new Error('The model returned an empty response'), data.provider),
        reason: 'error',
      };
    }

    try {
      for await (const chunk of readProtocolChunks(response.body)) {
        if (signal.aborted) break;
        uploader.push(chunk);
        onOutput?.(chunk);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      return { error: toRelayError(error, data.provider), reason: 'error' };
    }

    if (signal.aborted) throw abortError();
    return { reason: 'done' };
  }

  /**
   * A non-chat call (one-shot relay): `generateObject` / `models` upload their
   * return value as JSON parts, `pullModel` the provider's progress text.
   */
  private async runMethod(
    method: Exclude<NonNullable<LlmExecuteData['method']>, 'chat'>,
    runtime: RelayRuntime,
    payload: Record<string, unknown>,
    uploader: RelayBatchUploader,
    signal: AbortSignal,
  ): Promise<NonNullable<LlmRelayBatch['final']>> {
    if (method === 'pullModel') {
      const response = await runtime.pullModel?.(payload, { signal });
      if (!response) throw new Error('This provider cannot download models');
      if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
      if (response.body) {
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          uploader.push({ data: decoder.decode(value, { stream: true }), type: 'progress' });
        }
      }
      if (signal.aborted) throw abortError();
      return { reason: 'done' };
    }

    const run = method === 'models' ? runtime.models : runtime.generateObject;
    if (!run) throw new Error(`This provider does not support ${method}`);
    // Cancelled while the runtime was created: never start a call nothing can stop.
    if (signal.aborted) throw abortError();
    const result = await untilAborted(run.call(runtime, payload, { signal }), signal);
    if (signal.aborted) throw abortError();

    // No parts reads as `undefined` on the server, as the direct runtime returns it.
    const json = result === undefined ? '' : JSON.stringify(result);
    for (let i = 0; i < json.length; i += RESULT_PART_CHARS) {
      uploader.push({ data: json.slice(i, i + RESULT_PART_CHARS), type: 'result_part' });
    }
    return { reason: 'done' };
  }

  private async fetchPayload(data: LlmExecuteData, signal: AbortSignal) {
    const doFetch = this.deps.fetch ?? fetch;
    const response = await doFetch(
      `${this.deps.serverBaseUrl ?? ''}/api/agent/llm-relay/${encodeURIComponent(data.callId)}/payload`,
      { headers: { [LLM_RELAY_LEASE_HEADER]: data.leaseToken }, signal },
    );
    if (!response.ok) {
      throw new Error(`Failed to load the relayed request (HTTP ${response.status})`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private remember(callId: string) {
    this.settled.add(callId);
    if (this.settled.size > SETTLED_CALL_MEMORY) {
      const oldest = this.settled.values().next().value;
      if (oldest) {
        this.settled.delete(oldest);
        this.owned.delete(oldest);
      }
    }
  }
}
