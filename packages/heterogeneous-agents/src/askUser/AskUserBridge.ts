import { randomUUID } from 'node:crypto';

import type {
  AgentInterventionRequestData,
  AgentStreamEvent,
} from '@lobechat/agent-gateway-client';

/**
 * What the MCP handler gets back from `bridge.pending()`.
 *
 * `result` carries the user's structured answer when they submit; `cancelled`
 * with a reason when the deadline elapses, the user cancels, or the producer
 * tears the session down. Mutually exclusive — exactly one of `result` /
 * `cancelled` is set.
 */
export interface InterventionAnswer {
  cancelled?: boolean;
  cancelReason?: 'timeout' | 'user_cancelled' | 'session_ended';
  result?: unknown;
}

export interface PendingArgs {
  /** Whatever the MCP tool's input schema accepted (e.g. `{ questions: [...] }`). */
  arguments: unknown;
  /**
   * Wire correlation key for this intervention. Used as the `toolCallId`
   * on outbound `agent_intervention_request` events and looked up by
   * `resolve()` / `cancel()` when the user submits an answer.
   *
   * For CC, the producer should pass `extra._meta['claudecode/toolUseId']`
   * here so it equals the existing tool message id on the renderer side
   * (the assistant `tool_use` for `mcp__lobe_cc__ask_user_question` and
   * the intervention request both reference the same tool bubble).
   *
   * If omitted, the bridge synthesizes a random UUID — fine for
   * stand-alone tests, but the renderer won't be able to correlate.
   */
  toolCallId?: string;
}

export interface PendingOptions {
  /**
   * Called every `progressIntervalMs` while the call is pending. Use it to
   * push MCP `notifications/progress` to keep the SSE channel from timing
   * out (CC's HTTP transport drops at ~5min without keepalive).
   *
   * `elapsedMs` is the wall-clock millis since `pending()` was called.
   */
  onProgress?: (elapsedMs: number, totalMs: number) => void | Promise<void>;
  /** How often to call `onProgress`. Default: 30 000 (30s). */
  progressIntervalMs?: number;
  /**
   * Absolute deadline (`Date.now() + timeoutMs`). When it elapses, the
   * pending promise resolves with `{ cancelled: true, cancelReason: 'timeout' }`.
   * Default: 5 minutes.
   */
  timeoutMs?: number;
}

interface PendingEntry {
  cleanup: () => void;
  reject: (err: unknown) => void;
  resolve: (answer: InterventionAnswer) => void;
}

interface BridgeOptions {
  /**
   * Stamps `stepIndex` on emitted events. The bridge has no visibility into
   * the CC adapter's own step counter, so the producer (which owns the
   * merged stream) provides it. Defaults to a constant `0` — fine for unit
   * tests, but real producers should plug in their adapter's current value.
   */
  getStepIndex?: () => number;
}

/**
 * Per-operation channel between an MCP tool handler (which awaits the user)
 * and the producer's outbound stream (which carries the request to UI and
 * receives the user's answer back).
 *
 * Lifecycle:
 * 1. Producer constructs a bridge for an `operationId`.
 * 2. The MCP handler calls `pending(args, opts)` — gets a Promise.
 * 3. Bridge synthesizes a `toolCallId`, emits an
 *    `agent_intervention_request` AgentStreamEvent on `events()` for the
 *    producer to forward.
 * 4. Producer eventually calls `resolve(toolCallId, payload)` (from the
 *    consumer's `agent_intervention_response`) — Promise resolves.
 * 5. Or: deadline / `cancelAll()` rejects the pending Promise with a
 *    `{ cancelled: true, cancelReason }` answer (no exception thrown).
 *
 * Errors only surface from `pending()` if the bridge itself is misused
 * (e.g. emitting after `cancelAll`). Cancellation/timeout is normal flow,
 * not an exception.
 */
export class AskUserBridge {
  private readonly pending_ = new Map<string, PendingEntry>();
  private readonly outboundQueue: AgentStreamEvent[] = [];
  private readonly outboundWaiters: Array<(value: IteratorResult<AgentStreamEvent>) => void> = [];
  private readonly getStepIndex: () => number;
  private closed = false;

  constructor(
    public readonly operationId: string,
    options: BridgeOptions = {},
  ) {
    this.getStepIndex = options.getStepIndex ?? (() => 0);
  }

  /** Currently-blocked MCP handler count. Useful for telemetry / shutdown gates. */
  get pendingCount(): number {
    return this.pending_.size;
  }

  /**
   * Block the caller until the consumer answers (or the deadline / cancel
   * fires). Always resolves; never throws unless the bridge is already
   * closed (programming error).
   */
  pending(args: PendingArgs, options: PendingOptions = {}): Promise<InterventionAnswer> {
    if (this.closed) {
      return Promise.reject(new Error('AskUserBridge is closed; cannot accept new pending calls'));
    }

    const toolCallId = args.toolCallId ?? randomUUID();
    if (this.pending_.has(toolCallId)) {
      // Two pendings on the same key would clobber each other. Caller bug;
      // surface it loudly rather than silently lose one resolve.
      return Promise.reject(
        new Error(`AskUserBridge: duplicate toolCallId in flight: ${toolCallId}`),
      );
    }
    const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
    const progressIntervalMs = options.progressIntervalMs ?? 30_000;
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;

    return new Promise<InterventionAnswer>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        this.pending_.delete(toolCallId);
        clearInterval(progressTimer);
        resolve({ cancelled: true, cancelReason: 'timeout' });
      }, timeoutMs);

      const progressTimer: ReturnType<typeof setInterval> | undefined = options.onProgress
        ? setInterval(() => {
            const elapsed = Date.now() - startedAt;
            // Fire-and-forget; consumer-side errors are logged by caller.
            void Promise.resolve(options.onProgress!(elapsed, timeoutMs)).catch(() => {});
          }, progressIntervalMs)
        : undefined;

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (progressTimer) clearInterval(progressTimer);
      };

      this.pending_.set(toolCallId, { cleanup, reject, resolve });

      // Emit the intervention request AFTER setting up the pending entry,
      // so any synchronous resolve from a test fixture finds the slot.
      // Hardcoded to AskUserQuestion for now — the only intervention shape
      // we support. Take an explicit `apiName` in PendingArgs when adding
      // more (e.g. CC approval, file picker).
      const data: AgentInterventionRequestData = {
        apiName: 'askUserQuestion',
        arguments: JSON.stringify(args.arguments ?? {}),
        deadline,
        identifier: 'claude-code',
        toolCallId,
      };
      this.emit({
        data,
        operationId: this.operationId,
        stepIndex: this.getStepIndex(),
        timestamp: startedAt,
        type: 'agent_intervention_request',
      });
    });
  }

  /**
   * Producer-side: called when an `agent_intervention_response` arrives
   * from the consumer. No-op if the toolCallId is unknown (already
   * timed out, cancelled, or a stale duplicate).
   */
  resolve(
    toolCallId: string,
    payload: {
      cancelled?: boolean;
      cancelReason?: InterventionAnswer['cancelReason'];
      result?: unknown;
    },
  ): void {
    const entry = this.pending_.get(toolCallId);
    if (!entry) return;
    this.pending_.delete(toolCallId);
    entry.cleanup();
    entry.resolve(
      payload.cancelled
        ? { cancelReason: payload.cancelReason ?? 'user_cancelled', cancelled: true }
        : { result: payload.result },
    );
  }

  /**
   * Cancel a single pending call. Used when the consumer explicitly aborts
   * one intervention without ending the whole op.
   */
  cancel(toolCallId: string, reason: InterventionAnswer['cancelReason'] = 'user_cancelled'): void {
    this.resolve(toolCallId, { cancelReason: reason, cancelled: true });
  }

  /**
   * Tear down the bridge. Every pending handler is resolved with
   * `cancelled: true, reason='session_ended'` (so its MCP tool returns
   * cleanly to CC), the outbound event stream closes, and subsequent
   * `pending()` calls reject.
   */
  cancelAll(reason: InterventionAnswer['cancelReason'] = 'session_ended'): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending_.values()) {
      entry.cleanup();
      entry.resolve({ cancelReason: reason, cancelled: true });
    }
    this.pending_.clear();
    // Drain any waiters with a "done" so consumers can break their loop.
    while (this.outboundWaiters.length > 0) {
      const waiter = this.outboundWaiters.shift()!;
      waiter({ done: true, value: undefined as any });
    }
  }

  /**
   * Async iterable over outbound events the producer should forward to the
   * consumer. One iterator per bridge — multi-consumer fan-out is the
   * producer's job. Iterator ends after `cancelAll()`.
   */
  events(): AsyncIterable<AgentStreamEvent> {
    return {
      [Symbol.asyncIterator]: () => this.makeIterator(),
    };
  }

  private makeIterator(): AsyncIterator<AgentStreamEvent> {
    return {
      next: () => {
        const buffered = this.outboundQueue.shift();
        if (buffered) {
          return Promise.resolve({ done: false, value: buffered });
        }
        if (this.closed) {
          return Promise.resolve({ done: true, value: undefined as any });
        }
        return new Promise((resolveWaiter) => {
          this.outboundWaiters.push(resolveWaiter);
        });
      },
      return: () => Promise.resolve({ done: true, value: undefined as any }),
    };
  }

  private emit(event: AgentStreamEvent): void {
    const waiter = this.outboundWaiters.shift();
    if (waiter) {
      waiter({ done: false, value: event });
    } else {
      this.outboundQueue.push(event);
    }
  }
}
