import type { ToolExecuteData } from '@lobechat/agent-gateway-client';
import type { ChatMessageError } from '@lobechat/types';
import debug from 'debug';
import urlJoin from 'url-join';

import { sanitizeVisitorError } from '@/database/models/message';

import {
  buildPublicEndEventData,
  buildPublicInitEventData,
  FULL_STRIP_REDACTION,
  type GatewayVisitorRedaction,
  isShareVisitorInit,
  resolveRedactionFromState,
  sanitizeGatewayEventData,
} from './gatewayVisitorRedaction';
import {
  getDefaultReasonDetail,
  type StreamChunkData,
  type StreamEvent,
} from './StreamEventManager';
import type { IStreamEventManager, PublishAgentRuntimeEndParams } from './types';

const log = debug('lobe-server:agent-runtime:gateway-notifier');

const POST_TIMEOUT = 5000; // 5s per request
const MAX_INFLIGHT = 20; // bounded concurrency

/**
 * Decorator that wraps an IStreamEventManager and additionally pushes events
 * to the Agent Gateway via HTTP. Runtime init is an awaited ordering barrier;
 * subsequent event delivery remains best-effort and mostly fire-and-forget.
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

  /**
   * `operationId → visitor redaction policy` for confirmed shared-agent visitor
   * runs. `step_start` events carry neither `streamOwnerUserId` (only on
   * `agent_runtime_init`'s `initialState`) nor `finalState` (only on
   * `agent_runtime_end` / `step_complete`), so this per-operation entry is the
   * only signal `pushEvent` has for scrubbing `uiMessages` on those events.
   * Mirrors `mirrorTargets`'s two population paths:
   *  - fast path: set at `publishAgentRuntimeInit` / `publishAgentRuntimeEnd`
   *    from the state's `metadata.agentShareVisitor`, so the share's real
   *    `showModelInfo` / `showErrorDetails` config is honored.
   *  - queue path: lazily resolved from persisted op metadata via
   *    `resolvePersistedShareVisitor`, which can only tell share-or-not — it
   *    therefore falls back to {@link FULL_STRIP_REDACTION}.
   * Cleared at `publishAgentRuntimeEnd`.
   */
  private shareVisitorOps = new Map<string, GatewayVisitorRedaction>();
  /** Ops whose share-visitor status has been resolved (confirmed share OR not). */
  private shareVisitorResolved = new Set<string>();
  /** In-flight resolutions, deduped per op so concurrent events share one read. */
  private shareVisitorResolving = new Map<string, Promise<GatewayVisitorRedaction>>();

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
    /**
     * Resolves an op's persisted share-visitor redaction policy (from
     * `streamOwnerUserId` + `visitorRedaction` on op metadata); `null` for a
     * normal run. Lets a queue worker — which never ran the op's init — still
     * scrub events for that op. Omitted ⇒ in-process map only (safe: init
     * always precedes events for the op it created).
     */
    private resolvePersistedShareVisitor?: (
      operationId: string,
    ) => Promise<GatewayVisitorRedaction>,
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

    // Ordering barrier: a subscriber connects immediately after execAgent
    // returns and asks the Gateway for the operation's authoritative status.
    // If init is still fire-and-forget, that resume can win the race and report
    // a live heterogeneous/device run as terminal before its first producer
    // event arrives. httpPost intentionally swallows Gateway failures, so
    // awaiting it preserves best-effort semantics while preventing the normal
    // success path from exposing an operation before the Gateway knows it. Init
    // uses the non-lossy request lane: ordinary stream events may be dropped at
    // MAX_INFLIGHT, but dropping this control-plane barrier would recreate the
    // exact resume-before-init race under load.
    // Record share-visitor status up front (definitively known from
    // `initialState` here) so every later event for this op — including
    // `step_start`, which carries neither `streamOwnerUserId` nor `finalState`
    // — is sanitized without re-resolving.
    const initRedaction = resolveRedactionFromState(initialState);
    const isShareInit = isShareVisitorInit(initialState);
    if (initRedaction || isShareInit) {
      // Fail closed: `streamOwnerUserId` alone (without a readable
      // `metadata.agentShareVisitor`) still means a visitor is on the other end.
      this.shareVisitorOps.set(operationId, initRedaction ?? FULL_STRIP_REDACTION);
    }
    this.shareVisitorResolved.add(operationId);

    try {
      // The gateway DO requires the subscriber JWT's `sub` to equal the userId
      // registered here. `streamOwnerUserId` (shared-agent visitor runs) takes
      // precedence: the op executes as the creator, but only the visitor may
      // subscribe to its stream.
      await this.httpPostAwait('/api/operations/init', {
        operationId,
        userId: initialState?.streamOwnerUserId || initialState?.userId || 'unknown',
      });
    } catch (error) {
      log('Gateway /api/operations/init failed: %O', error);
    }

    void this.pushEvent(operationId, {
      // Share-visitor runs must not receive the creator's raw operation
      // metadata (agentConfig / system prompt, modelRuntimeConfig, userId,
      // workspaceId) over their WS channel — see `buildPublicInitEventData`.
      data: isShareInit ? buildPublicInitEventData(initialState) : initialState,
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

    const endRedaction = resolveRedactionFromState(finalState);

    // `errorType`/`reasonDetail` both read `finalState.error` — the same
    // `formatErrorForState` shape `sanitizeVisitorError` projects for
    // `toVisitorMessage` — but land as SIBLINGS of `finalState` on
    // `endEventData` below, so `buildPublicEndEventData`'s wholesale
    // `finalState` drop does not touch them. For a share-visitor run, run the
    // SAME classification here rather than trusting the raw `reasonDetail` the
    // caller passed in: this Gateway push is the enforcement boundary
    // regardless of what upstream already computed from the unredacted error.
    const rawErrorType = finalState?.error?.type ?? finalState?.error?.errorType;
    const safeError = endRedaction
      ? sanitizeVisitorError(
          rawErrorType === undefined
            ? undefined
            : ({ message: finalState?.error?.message, type: rawErrorType } as ChatMessageError),
          endRedaction,
        )
      : undefined;
    const effectiveReasonDetail = endRedaction
      ? safeError?.message || getDefaultReasonDetail(undefined, reason)
      : reasonDetail || getDefaultReasonDetail(finalState, reason);
    const errorType = endRedaction ? safeError?.type : rawErrorType;

    // `finalState` already tells us definitively whether this is a share run,
    // so record it before pushing — covers the case where this runs in a
    // process that never saw the op's `publishAgentRuntimeInit` (queue mode)
    // without waiting on the async metadata resolver.
    if (endRedaction) this.shareVisitorOps.set(operationId, endRedaction);
    this.shareVisitorResolved.add(operationId);

    // Forward `uiMessages` to the gateway push channel so terminal-state
    // clients consuming /push-event get the canonical UIChatMessage[]
    // snapshot — the final step has no later step_start to carry a fresh
    // snapshot, so dropping it here would break the SoT contract.
    const endEventData = {
      errorType,
      finalState,
      reason,
      reasonDetail: effectiveReasonDetail,
      ...(uiMessages !== undefined && { uiMessages }),
    };

    void this.pushEvent(operationId, {
      // Share-visitor runs must not receive the creator's raw AgentState
      // (metadata.userMemory / metadata.agentConfig, systemRole,
      // userInterventionConfig, ...) over their WS channel — see
      // `buildPublicEndEventData`.
      data: endRedaction ? buildPublicEndEventData(endEventData) : endEventData,
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
    this.shareVisitorOps.delete(operationId);
    this.shareVisitorResolved.delete(operationId);
    this.shareVisitorResolving.delete(operationId);

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

  async readEventsOnce(
    operationId: string,
    lastEventId?: string,
    blockMs?: number,
  ): Promise<{ events: StreamEvent[]; lastEventId: string }> {
    return this.inner.readEventsOnce(operationId, lastEventId, blockMs);
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
    // Resolve share-visitor status BEFORE building the sanitized payload — the
    // synchronous fast path (the common case: `publishAgentRuntimeInit` /
    // `publishAgentRuntimeEnd` always mark this resolved before calling
    // `pushEvent`) keeps this whole method's pre-`mirrorTargets.get` prefix
    // synchronous, preserving the ordering the mirror-cleanup-after-call
    // pattern in `publishAgentRuntimeEnd` relies on. Only a queue worker's
    // first event for an op it never initialized falls through to the async
    // `resolveShareVisitor` — see its fail-closed contract.
    const known = this.isShareVisitorKnown(operationId);
    const redaction = known === undefined ? await this.resolveShareVisitor(operationId) : known;

    // Mirror the Redis publisher's chokepoint — strip
    // `finalState.messages` + tool-set fields off the gateway WS push
    // payload too. The gateway forwards events verbatim to clients, and
    // downstream consumers don't read these fields, so carrying them
    // would re-introduce the same multi-megabyte serialization that
    // crashed the xadd path. Additionally, for a shared-agent visitor run,
    // drop `finalState` wholesale and scrub the rest — see
    // `sanitizeGatewayEventData`.
    const sanitizedEvent =
      event.data === undefined
        ? event
        : { ...event, data: sanitizeGatewayEventData(event.data, redaction, event.type) };
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
   * Synchronous share-visitor lookup. Returns `undefined` only when a queue
   * worker resolver is configured AND this op's status hasn't been resolved yet
   * (its first event, in a process that never ran its init) — the caller must
   * then fall back to the async {@link resolveShareVisitor}.
   *
   * Without a configured resolver (non-queue mode), an unresolved op is treated
   * as a normal run synchronously rather than going through the async path at
   * all — this keeps `pushEvent`'s common-case prefix fully synchronous,
   * matching `mirrorTargets.get`'s behavior and the `stream_end` await-ordering
   * contract on `publishStreamEvent`. It's also the correct default: without a
   * resolver this notifier only ever sees events for ops it initialized itself,
   * and init marks resolved synchronously before any event is pushed.
   */
  private isShareVisitorKnown(operationId: string): GatewayVisitorRedaction | undefined {
    const cached = this.shareVisitorOps.get(operationId);
    if (cached) return cached;
    if (this.shareVisitorResolved.has(operationId)) return null;
    if (!this.resolvePersistedShareVisitor) return null;
    return undefined;
  }

  /**
   * Resolve and cache whether an op is a shared-agent visitor run, from
   * persisted metadata (`streamOwnerUserId`). Only reached when a resolver is
   * configured and the op is still unresolved (see {@link isShareVisitorKnown}).
   * Deduped so concurrent events for the same unresolved op share one metadata
   * read.
   *
   * Fails closed: a resolution error returns the full strip rather than risk
   * leaking the creator's identity, and deliberately does NOT cache that
   * outcome as resolved, so the next event retries once the transient failure
   * clears.
   */
  private resolveShareVisitor(operationId: string): Promise<GatewayVisitorRedaction> {
    if (!this.resolvePersistedShareVisitor) return Promise.resolve(null);

    let pending = this.shareVisitorResolving.get(operationId);
    if (!pending) {
      pending = this.resolvePersistedShareVisitor(operationId)
        .then((resolved) => {
          this.shareVisitorResolved.add(operationId);
          this.shareVisitorResolving.delete(operationId);
          if (!resolved) return null;
          this.shareVisitorOps.set(operationId, resolved);
          return resolved;
        })
        .catch((error) => {
          this.shareVisitorResolving.delete(operationId);
          log('[%s] Share visitor resolution failed, failing closed: %O', operationId, error);
          return FULL_STRIP_REDACTION;
        });
      this.shareVisitorResolving.set(operationId, pending);
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
