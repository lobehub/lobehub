import type { LlmRelayBatch, LlmRelayBatchAck } from '@lobechat/agent-gateway-client';
import { LLM_RELAY_LEASE_HEADER } from '@lobechat/agent-gateway-client';

import type { RelayProtocolChunk } from './protocolChunks';

/** Flush the pending chunks at most this long after the first one arrived. */
export const LLM_RELAY_FLUSH_INTERVAL_MS = 200;
/** Flush right away once this many bytes are pending. */
export const LLM_RELAY_FLUSH_BYTES = 64 * 1024;
/** Send an empty batch when nothing went out for this long (model cold start). */
export const LLM_RELAY_HEARTBEAT_MS = 10_000;

const MAX_SEND_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Why the server refused this client's upload. Every one of them means "stop
 * working on this call": another client owns it (`claimed`), it is over
 * (`closed`, `cancelled`), or this client may not write it (`unauthorized`,
 * `too_large`).
 */
export type RelayUploadRejection =
  'cancelled' | 'claimed' | 'closed' | 'too_large' | 'unauthorized' | 'unreachable';

export class RelayUploadRejectedError extends Error {
  constructor(readonly reason: RelayUploadRejection) {
    super(`LLM relay upload rejected: ${reason}`);
    this.name = 'RelayUploadRejectedError';
  }
}

const rejectionOf = (status: number): RelayUploadRejection | undefined => {
  switch (status) {
    case 401:
    case 403: {
      return 'unauthorized';
    }
    case 409: {
      return 'claimed';
    }
    case 410: {
      return 'closed';
    }
    case 413: {
      return 'too_large';
    }
  }
};

export interface RelayBatchUploaderOptions {
  callId: string;
  clientId: string;
  fetch?: typeof fetch;
  leaseToken: string;
  /** Called once when the server refuses an upload; the call must stop. */
  onRejected: (reason: RelayUploadRejection) => void;
  /** Base of the relay endpoints, `''` for same-origin. */
  serverBaseUrl?: string;
}

/**
 * Client half of the relay's upload channel (T-540 §3.2): collects the
 * attempt's protocol chunks and posts them as numbered batches to
 * `POST /api/agent/llm-relay/:callId/chunks`.
 *
 * - batches go out every 200 ms or at 64 KB, one request at a time, so `seq`
 *   reaches the server in order; a transient failure retries the same `seq`,
 *   which the server dedupes
 * - an empty batch is sent after 10 s without output, so a model that is
 *   still loading is not taken for a lost executor
 * - any refusal (`409` claimed elsewhere, `410` closed, `cancel: true` on the
 *   ack, …) is reported once through `onRejected` and ends the upload
 */
export class RelayBatchUploader {
  private seq = 0;
  private pending: RelayProtocolChunk[] = [];
  private pendingBytes = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private lastSentAt = 0;
  private sending: Promise<void> = Promise.resolve();
  private rejected: RelayUploadRejection | undefined;
  private finished = false;

  constructor(private readonly options: RelayBatchUploaderOptions) {}

  get rejection() {
    return this.rejected;
  }

  /**
   * Claim the call with an empty first batch. Resolves `true` when this client
   * now owns the call; `false` when the server gave it to someone else or it
   * is already over.
   */
  async claim(): Promise<boolean> {
    await this.enqueueSend([]);
    if (this.rejected) return false;

    this.heartbeatTimer = setInterval(() => {
      if (this.finished || this.rejected || this.pending.length > 0) return;
      if (Date.now() - this.lastSentAt >= LLM_RELAY_HEARTBEAT_MS) void this.enqueueSend([]);
    }, LLM_RELAY_HEARTBEAT_MS / 2);

    return true;
  }

  push(chunk: RelayProtocolChunk) {
    if (this.finished || this.rejected) return;

    this.pending.push(chunk);
    this.pendingBytes += JSON.stringify(chunk).length;

    // Also flush on arrival once the interval has passed: a background tab's
    // timers are throttled (down to once a minute), the model's chunks are not.
    if (
      this.pendingBytes >= LLM_RELAY_FLUSH_BYTES ||
      Date.now() - this.lastSentAt >= LLM_RELAY_FLUSH_INTERVAL_MS
    ) {
      this.flush();
      return;
    }
    this.flushTimer ??= setTimeout(() => this.flush(), LLM_RELAY_FLUSH_INTERVAL_MS);
  }

  /** Send everything still pending together with the attempt's final marker. */
  async finish(final: NonNullable<LlmRelayBatch['final']>): Promise<void> {
    if (this.finished) return this.sending;
    this.finished = true;
    this.stopTimers();

    if (!this.rejected) {
      const chunks = this.takePending();
      void this.enqueueSend(chunks, final);
    }
    await this.sending;
  }

  /** Stop without telling the server (it already knows, or refused us). */
  dispose() {
    this.finished = true;
    this.stopTimers();
    this.pending = [];
    this.pendingBytes = 0;
  }

  private flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.pending.length === 0 || this.rejected) return;
    void this.enqueueSend(this.takePending());
  }

  private takePending() {
    const chunks = this.pending;
    this.pending = [];
    this.pendingBytes = 0;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    return chunks;
  }

  private stopTimers() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.flushTimer = undefined;
    this.heartbeatTimer = undefined;
  }

  private enqueueSend(chunks: RelayProtocolChunk[], final?: LlmRelayBatch['final']) {
    this.seq += 1;
    const batch: LlmRelayBatch = {
      chunks,
      clientId: this.options.clientId,
      ...(final && { final }),
      seq: this.seq,
    };
    this.lastSentAt = Date.now();
    this.sending = this.sending.then(() => this.send(batch));
    return this.sending;
  }

  private async send(batch: LlmRelayBatch): Promise<void> {
    if (this.rejected) return;

    const { callId, leaseToken, serverBaseUrl = '' } = this.options;
    const doFetch = this.options.fetch ?? fetch;
    const body = JSON.stringify(batch);

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
      try {
        const response = await doFetch(
          `${serverBaseUrl}/api/agent/llm-relay/${encodeURIComponent(callId)}/chunks`,
          {
            body,
            headers: { 'content-type': 'application/json', [LLM_RELAY_LEASE_HEADER]: leaseToken },
            method: 'POST',
          },
        );

        const rejection = rejectionOf(response.status);
        if (rejection) return this.reject(rejection);

        if (response.ok) {
          const ack = (await response.json().catch(() => ({}))) as Partial<LlmRelayBatchAck>;
          if (ack.cancel) this.reject('cancelled');
          return;
        }
      } catch {
        // Network failure: retry the same seq below; the server dedupes it.
      }

      if (attempt < MAX_SEND_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)),
        );
      }
    }

    // The server stays unreachable. Its idle deadline re-dispatches the
    // attempt; this client stops instead of streaming into the void.
    this.reject('unreachable');
  }

  private reject(reason: RelayUploadRejection) {
    if (this.rejected) return;
    this.rejected = reason;
    this.stopTimers();
    this.options.onRejected(reason);
  }
}
