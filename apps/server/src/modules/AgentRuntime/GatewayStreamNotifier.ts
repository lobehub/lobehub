import type { ToolExecuteData } from '@lobechat/agent-gateway-client';
import debug from 'debug';
import urlJoin from 'url-join';

import {
  getDefaultReasonDetail,
  type StreamChunkData,
  type StreamEvent,
  stripFinalStateInEventData,
} from './StreamEventManager';
import type { IStreamEventManager, PublishAgentRuntimeEndParams } from './types';

const log = debug('lobe-server:agent-runtime:gateway-notifier');

const POST_TIMEOUT = 5000; // 5s per request
const MAX_INFLIGHT = 20; // bounded concurrency

/**
 * Decorator that wraps an IStreamEventManager and additionally
 * pushes events to the Agent Gateway via HTTP (fire-and-forget).
 *
 * Redis SSE remains the primary event storage / subscription mechanism.
 * The Gateway is an additional push channel for WebSocket delivery.
 */
export class GatewayStreamNotifier implements IStreamEventManager {
  private inflight = 0;

  /**
   * `operationId → mirrorOperationId`. When an operation declares a
   * `mirrorToOperationId` (an in-group broadcast/speak member pointing at its
   * supervisor op), every Gateway push for that operation is additionally
   * delivered to the mirror op's channel — so member streaming events ride down
   * the supervisor's single WebSocket instead of stranding on a per-member
   * channel nobody subscribes to (single-connection multiplexing).
   *
   * Two population paths, so this works both in-process AND across queue workers:
   *  - fast path: set at `publishAgentRuntimeInit` from the initial state (the
   *    in-memory runtime, and the process that created the op).
   *  - queue path: in `AGENT_RUNTIME_MODE=queue` the member's chunks are emitted
   *    by a QStash worker that never ran init for that op, so its map starts
   *    empty. `pushEvent` then lazily resolves the target from PERSISTED op
   *    metadata via `resolveMirrorTarget` (Redis) on the op's first event and
   *    caches it — converging the worker onto the same mapping.
   * Cleared at `publishAgentRuntimeEnd`.
   */
  private mirrorTargets = new Map<string, string>();
  /** Ops whose mirror target has been resolved (target found OR confirmed none). */
  private mirrorResolved = new Set<string>();
  /** In-flight resolutions, deduped per op so concurrent events share one read. */
  private mirrorResolving = new Map<string, Promise<string | undefined>>();

  constructor(
    private inner: IStreamEventManager,
    private gatewayUrl: string,
    private serviceToken: string,
    /**
     * Resolves an op's persisted `mirrorToOperationId` (from op metadata). Lets a
     * queue worker — which never ran the op's init — still mirror its stream
     * events onto the supervisor channel. Omitted ⇒ in-process map only.
     */
    private resolveMirrorTarget?: (operationId: string) => Promise<string | undefined>,
  ) {
    log('Gateway notifier initialized: %s', gatewayUrl);
  }

  // ─── Publish methods: delegate to inner + notify gateway ───

  async publishStreamEvent(
    operationId: string,
    event: Omit<StreamEvent, 'operationId' | 'timestamp'>,
  ): Promise<string> {
    const result = await this.inner.publishStreamEvent(operationId, event);
    const gatewayEvent = { ...event, operationId, timestamp: Date.now() };
    if (event.type === 'stream_end') {
      // `visible_output_end` may be published immediately after `stream_end`.
      // Await the Gateway push for this boundary so the client applies
      // stream_end.finalContent before closing visible loading/reasoning.
      await this.pushEvent(operationId, gatewayEvent);
    } else {
      void this.pushEvent(operationId, gatewayEvent);
    }
    return result;
  }

  async publishStreamChunk(
    operationId: string,
    stepIndex: number,
    chunkData: StreamChunkData,
  ): Promise<string> {
    const result = await this.inner.publishStreamChunk(operationId, stepIndex, chunkData);
    void this.pushEvent(operationId, {
      data: chunkData,
      operationId,
      stepIndex,
      timestamp: Date.now(),
      type: 'stream_chunk',
    });
    return result;
  }

  async publishAgentRuntimeInit(operationId: string, initialState: any): Promise<string> {
    const result = await this.inner.publishAgentRuntimeInit(operationId, initialState);

    // Register the mirror target (if any) before the first event flows, so this
    // op's whole stream — including the events below — fans out to the
    // supervisor's channel too.
    const mirrorTo = initialState?.mirrorToOperationId;
    if (typeof mirrorTo === 'string' && mirrorTo && mirrorTo !== operationId) {
      this.mirrorTargets.set(operationId, mirrorTo);
      log('mirror registered: %s → %s', operationId, mirrorTo);
    }

    this.httpPost('/api/operations/init', {
      operationId,
      userId: initialState?.userId || 'unknown',
    });

    void this.pushEvent(operationId, {
      data: initialState,
      operationId,
      stepIndex: 0,
      timestamp: Date.now(),
      type: 'agent_runtime_init',
    });

    return result;
  }

  async publishAgentRuntimeEnd(params: PublishAgentRuntimeEndParams): Promise<string> {
    const { operationId, stepIndex, finalState, reason, reasonDetail, uiMessages } = params;
    const result = await this.inner.publishAgentRuntimeEnd(params);

    const effectiveReasonDetail = reasonDetail || getDefaultReasonDetail(finalState, reason);
    const errorType = finalState?.error?.type || finalState?.error?.errorType;

    void this.pushEvent(operationId, {
      // Forward `uiMessages` to the gateway push channel so terminal-state
      // clients consuming /push-event get the canonical UIChatMessage[]
      // snapshot — the final step has no later step_start to carry a fresh
      // snapshot, so dropping it here would break the SoT contract.
      data: {
        errorType,
        finalState,
        reason,
        reasonDetail: effectiveReasonDetail,
        ...(uiMessages !== undefined && { uiMessages }),
      },
      operationId,
      stepIndex,
      timestamp: Date.now(),
      type: 'agent_runtime_end',
    });

    // Terminal event has been forwarded (including any mirror); drop the mapping
    // so it can't leak across a reused operationId.
    this.mirrorTargets.delete(operationId);
    this.mirrorResolved.delete(operationId);
    this.mirrorResolving.delete(operationId);

    return result;
  }

  /**
   * Request the client to execute a tool via Agent Gateway → WebSocket.
   * Unlike the other push methods this is NOT fire-and-forget: callers rely
   * on the promise outcome to decide whether to block-await a result or
   * fall back to the interrupt-resume path. Rejects on HTTP error / timeout.
   */
  async sendToolExecute(operationId: string, data: ToolExecuteData): Promise<void> {
    log('sendToolExecute operation=%s toolCallId=%s', operationId, data.toolCallId);
    await this.httpPostAwait('/api/operations/tool-execute', { data, operationId });
  }

  // ─── Read / subscribe methods: delegate directly to inner ───

  async subscribeStreamEvents(
    operationId: string,
    lastEventId: string,
    onEvents: (events: StreamEvent[]) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.inner.subscribeStreamEvents(operationId, lastEventId, onEvents, signal);
  }

  async getStreamHistory(operationId: string, count?: number): Promise<StreamEvent[]> {
    return this.inner.getStreamHistory(operationId, count);
  }

  async cleanupOperation(operationId: string): Promise<void> {
    return this.inner.cleanupOperation(operationId);
  }

  async getActiveOperationsCount(): Promise<number> {
    return this.inner.getActiveOperationsCount();
  }

  async disconnect(): Promise<void> {
    return this.inner.disconnect();
  }

  // ─── Gateway HTTP helpers ───

  private async pushEvent(operationId: string, event: Record<string, unknown>): Promise<void> {
    // Mirror the Redis publisher's chokepoint — strip
    // `finalState.messages` + tool-set fields off the gateway WS push
    // payload too. The gateway forwards events verbatim to clients, and
    // downstream consumers don't read these fields, so carrying them
    // would re-introduce the same multi-megabyte serialization that
    // crashed the xadd path.
    const sanitizedEvent =
      event.data === undefined ? event : { ...event, data: stripFinalStateInEventData(event.data) };
    const pushes: Promise<void>[] = [
      this.httpPost('/api/operations/push-event', {
        event: sanitizedEvent,
        operationId,
      }),
    ];

    // Single-connection multiplexing: also deliver to the mirror op's channel so
    // the event rides down that connection's WebSocket. The event payload keeps
    // its own `operationId`, which the client's event router uses to demux it
    // back to the right member column. Only the delivery channel changes.
    const mirrorTo = this.mirrorTargets.get(operationId);
    if (mirrorTo) {
      pushes.push(this.mirrorPush(mirrorTo, sanitizedEvent));
      await Promise.all(pushes);
      return;
    }
    // Queue worker: target not in the in-process map. Resolve it from persisted
    // metadata once, then mirror this (and future) events. Concurrent events for
    // the same op share one resolution and fire their mirror pushes in order.
    if (!this.mirrorResolved.has(operationId)) {
      pushes.push(
        this.resolveMirror(operationId).then(async (target) => {
          if (target) await this.mirrorPush(target, sanitizedEvent);
        }),
      );
    }

    await Promise.all(pushes);
  }

  private mirrorPush(mirrorTo: string, event: Record<string, unknown>): Promise<void> {
    return this.httpPost('/api/operations/push-event', {
      event,
      operationId: mirrorTo,
    });
  }

  /**
   * Resolve and cache an op's mirror target from persisted metadata. Returns the
   * target (cached in `mirrorTargets`) or undefined when the op has none. Deduped
   * so many concurrent events trigger a single metadata read.
   */
  private resolveMirror(operationId: string): Promise<string | undefined> {
    const cached = this.mirrorTargets.get(operationId);
    if (cached) return Promise.resolve(cached);
    if (this.mirrorResolved.has(operationId) || !this.resolveMirrorTarget) {
      return Promise.resolve(undefined);
    }
    let pending = this.mirrorResolving.get(operationId);
    if (!pending) {
      pending = this.resolveMirrorTarget(operationId)
        .then((target) => {
          this.mirrorResolved.add(operationId);
          this.mirrorResolving.delete(operationId);
          if (target && target !== operationId) {
            this.mirrorTargets.set(operationId, target);
            return target;
          }
          return undefined;
        })
        .catch(() => {
          this.mirrorResolving.delete(operationId);
          return undefined;
        });
      this.mirrorResolving.set(operationId, pending);
    }
    return pending;
  }

  /**
   * POST that surfaces errors back to the caller (no swallow). Used for
   * request-response style pushes like tool_execute where the caller needs
   * to know whether the gateway accepted the request.
   */
  private async httpPostAwait(path: string, body: Record<string, unknown>): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT);

    try {
      const res = await fetch(urlJoin(this.gatewayUrl, path), {
        body: JSON.stringify(body),
        headers: {
          'Authorization': `Bearer ${this.serviceToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gateway ${path} returned ${res.status}: ${text}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async httpPost(path: string, body: Record<string, unknown>): Promise<void> {
    if (this.inflight >= MAX_INFLIGHT) {
      log('Gateway %s dropped: max inflight (%d) reached', path, MAX_INFLIGHT);
      return;
    }

    this.inflight++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT);

    try {
      const res = await fetch(urlJoin(this.gatewayUrl, path), {
        body: JSON.stringify(body),
        headers: {
          'Authorization': `Bearer ${this.serviceToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });

      if (!res.ok) {
        log('Gateway %s returned %d: %s', path, res.status, await res.text());
      }
    } catch (error) {
      log('Gateway %s failed: %O', path, error);
    } finally {
      clearTimeout(timer);
      this.inflight--;
    }
  }
}
