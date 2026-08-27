import type { ToolExecuteData } from '@lobechat/agent-gateway-client';
import type { ChatMessageError, UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import urlJoin from 'url-join';

import { sanitizeVisitorError, toVisitorMessage } from '@/database/models/message';

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
 * Whether `publishAgentRuntimeInit` is initializing a shared-agent visitor
 * run. The op EXECUTES as the creator, but `streamOwnerUserId` (set only for
 * agentShare runs — see `AgentRuntimeService.createOperation`) registers the
 * Gateway WS channel under the *visitor's* id, so the visitor is the one
 * receiving this push over the wire.
 */
const isShareVisitorInit = (initialState: any): boolean =>
  typeof initialState?.streamOwnerUserId === 'string' && initialState.streamOwnerUserId.length > 0;

/**
 * Whether `publishAgentRuntimeEnd`'s `finalState` belongs to a shared-agent
 * visitor run. `state.metadata.agentShare` is stamped once at operation
 * creation (see `AgentRuntimeService.createOperation`'s `initialState.metadata`)
 * and persists on the state through to the terminal event.
 */
const isShareVisitorEnd = (finalState: any): boolean =>
  Boolean(finalState?.metadata?.agentShare?.visitorUserId);

/**
 * Public `agent_runtime_init` DTO pushed to the Gateway for shared-agent
 * visitor runs. The full operation metadata must never cross the WS boundary
 * to the visitor. The client doesn't render anything from this event today —
 * `runAgent.ts`'s `agent_runtime_init` case only logs it — so `status` is the
 * only field forwarded.
 */
const buildPublicInitEventData = (initialState: any): { status?: unknown } => ({
  status: initialState?.status,
});

/**
 * Public `agent_runtime_end` DTO pushed to the Gateway for shared-agent
 * visitor runs. `finalState` is the creator's full `AgentState`, none of
 * which the client reads off this event (`gatewayEventHandler.ts` only
 * consumes `reason` and `uiMessages`, both already-sanitized UI-facing
 * values), so drop `finalState` wholesale instead of trying to allowlist
 * inside it.
 */
const buildPublicEndEventData = <T extends { finalState?: unknown }>(
  data: T,
): Omit<T, 'finalState'> => {
  const { finalState: _finalState, ...rest } = data;
  return rest;
};

/**
 * Sanitize a `uiMessages` snapshot for a shared-agent visitor's WS channel.
 * `uiMessages` is the canonical `UIChatMessage[]` built from the creator's
 * DB rows (`AgentRuntimeService.queryUiMessages` → `MessageService.queryMessages`,
 * a creator-scoped query — unlike `shareChat.getMessages`, which already goes
 * through `MessageModel.queryForVisitor`). Every `step_start` and the terminal
 * `agent_runtime_end` push carry this snapshot, so without this step the
 * creator's joined `sender` identity, `usage`, and `extra.model`/`extra.provider`
 * would ride down the visitor's Gateway WS channel even though `finalState` is
 * already scrubbed. Reuses `toVisitorMessage` — the same field list
 * `shareChat.getMessages` nulls out — so the two paths cannot drift apart.
 */
const sanitizeUiMessagesForVisitor = (uiMessages: unknown): unknown => {
  if (!Array.isArray(uiMessages)) return uiMessages;
  return (uiMessages as UIChatMessage[]).map((message) => toVisitorMessage(message));
};

/**
 * Sanitize a live `type: 'error'` Gateway stream event for a shared-agent
 * visitor. `ServerStreamSink.publishError` (`./adapters/ServerStreamSink.ts`)
 * builds this event's `data` from `formatErrorEventData`, which — like
 * `formatErrorForState` — copies the raw upstream `body` (provider, budget,
 * upstream diagnostic) straight onto the payload. This event is pushed
 * through `pushEvent` → `sanitizeGatewayEventData`, which — unlike the
 * `uiMessages` snapshot — never routed through `toVisitorMessage`: it only
 * knows about `finalState`/`uiMessages`, so an `error` event's `body` rode the
 * WS channel to the visitor completely unredacted, and the client
 * (`gatewayEventHandler.ts`'s `case 'error'`) immediately overlays it onto the
 * visible message via `internal_dispatchMessage` — reaching the visitor's
 * screen live, during the run, before any DB row (and therefore
 * `toVisitorMessage`) is ever involved. Reuses {@link sanitizeVisitorError}'s
 * classification so the live and reloaded-history projections cannot drift
 * apart, reshaped into `formatErrorEventData`'s flatter `{ body, error,
 * errorType, phase }` wire shape instead of `ChatMessageError`'s `{ body,
 * message, type }`.
 */
const sanitizeErrorEventDataForVisitor = (data: unknown): unknown => {
  if (!data || typeof data !== 'object') return data;
  const record = data as { error?: unknown; errorType?: unknown; phase?: unknown };

  const safe = sanitizeVisitorError(
    typeof record.errorType === 'string' || typeof record.errorType === 'number'
      ? ({
          message: typeof record.error === 'string' ? record.error : undefined,
          type: record.errorType,
        } as ChatMessageError)
      : undefined,
  );

  return {
    ...(safe?.message === undefined ? {} : { error: safe.message }),
    ...(safe?.type === undefined ? {} : { errorType: safe.type }),
    ...(record.phase === undefined ? {} : { phase: record.phase }),
  };
};

/**
 * Chokepoint applied to every event this notifier pushes to the Gateway WS
 * channel (`pushEvent`) — not just `agent_runtime_init` / `agent_runtime_end`.
 * Any event whose `data.finalState` belongs to a shared-agent visitor run
 * (`isShareVisitorEnd`) must not leak the creator's full `AgentState` over the
 * wire, so `finalState` is dropped wholesale — same DTO shape as
 * `buildPublicEndEventData`. Any event belonging to a shared-agent visitor run
 * (`isShareRun`, resolved by the caller — see `isShareVisitorKnown` /
 * `resolveShareVisitor`) also gets its `uiMessages` scrubbed via
 * `sanitizeUiMessagesForVisitor`, because
 * `step_start` carries `uiMessages` with neither `finalState` nor
 * `streamOwnerUserId` on the event payload itself.
 *
 * `agent_runtime_init` / `agent_runtime_end` already build their own public
 * DTO before calling `pushEvent` (`buildPublicInitEventData` /
 * `buildPublicEndEventData`), so the `finalState` drop is a no-op for them by
 * the time their `data` arrives here — but `agent_runtime_end`'s `uiMessages`
 * still needs the scrub applied here. `step_complete` — published via the
 * generic `publishStreamEvent` (e.g. `AgentRuntimeService`'s per-step
 * `finalState: stepResult.newState` push, and any other producer that lands
 * `finalState` on `publishStreamEvent`/`publishStreamChunk`) — has no
 * per-event DTO builder, so this chokepoint is its only sanitization point.
 * Falls back to the generic `stripFinalStateInEventData` (messages / tool-set
 * fields only) for non-share runs, matching the Redis xadd chokepoint.
 *
 * `eventType` additionally routes a live `type: 'error'` event through
 * {@link sanitizeErrorEventDataForVisitor} for share runs — see that
 * function's JSDoc for why this is a SEPARATE leak from `uiMessages`/
 * `finalState`: `error` events carry `formatErrorEventData`'s raw `{ body,
 * error, errorType }` shape directly, with no `finalState`/`uiMessages` key
 * for the checks above to even look at.
 */
const sanitizeGatewayEventData = (
  data: unknown,
  isShareRun: boolean,
  eventType?: unknown,
): unknown => {
  if (!data || typeof data !== 'object') return data;
  const record = data as Record<string, unknown>;

  const withoutFinalState: Record<string, unknown> =
    'finalState' in record && isShareVisitorEnd(record.finalState)
      ? (() => {
          const { finalState: _finalState, ...rest } = record;
          return rest;
        })()
      : (stripFinalStateInEventData(data) as Record<string, unknown>);

  if (!isShareRun) return withoutFinalState;

  if (eventType === 'error') return sanitizeErrorEventDataForVisitor(withoutFinalState);

  if (!('uiMessages' in withoutFinalState)) return withoutFinalState;

  return {
    ...withoutFinalState,
    uiMessages: sanitizeUiMessagesForVisitor(withoutFinalState.uiMessages),
  };
};

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
   * Ops confirmed to be shared-agent visitor runs. `step_start` events carry
   * neither `streamOwnerUserId` (only on `agent_runtime_init`'s `initialState`)
   * nor `finalState` (only on `agent_runtime_end` / `step_complete`), so this
   * per-operation flag is the only signal `pushEvent` has for scrubbing
   * `uiMessages` on those events. Mirrors `mirrorTargets`'s two population
   * paths:
   *  - fast path: set at `publishAgentRuntimeInit` from `isShareVisitorInit`.
   *  - queue path: lazily resolved from persisted op metadata via
   *    `resolvePersistedShareVisitor` on the op's first event in a process
   *    that never ran its init (e.g. a QStash worker).
   * Cleared at `publishAgentRuntimeEnd`.
   */
  private shareVisitorOps = new Set<string>();
  /** Ops whose share-visitor status has been resolved (confirmed true OR false). */
  private shareVisitorResolved = new Set<string>();
  /** In-flight resolutions, deduped per op so concurrent events share one read. */
  private shareVisitorResolving = new Map<string, Promise<boolean>>();

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
     * Resolves whether an op's persisted metadata marks it a shared-agent
     * visitor run (`streamOwnerUserId` set). Lets a queue worker — which never
     * ran the op's init — still scrub `uiMessages` on `step_start` events for
     * that op. Omitted ⇒ in-process map only (safe: init always precedes
     * events for the op it created).
     */
    private resolvePersistedShareVisitor?: (operationId: string) => Promise<boolean>,
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

    // Record share-visitor status before the first push so every later event,
    // including step_start snapshots, can be scrubbed consistently.
    if (isShareVisitorInit(initialState)) {
      this.shareVisitorOps.add(operationId);
    }
    this.shareVisitorResolved.add(operationId);

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
    try {
      await this.httpPostAwait('/api/operations/init', {
        operationId,
        // Shared-agent runs execute with creator-owned resources, while the
        // visitor is the only identity allowed to subscribe to this stream.
        userId: initialState?.streamOwnerUserId || initialState?.userId || 'unknown',
      });
    } catch (error) {
      log('Gateway /api/operations/init failed: %O', error);
    }
    void this.pushEvent(operationId, {
      // Share-visitor runs must not receive the creator's raw operation
      // metadata (agentConfig / system prompt, modelRuntimeConfig, userId,
      // workspaceId) over their WS channel — see `buildPublicInitEventData`.
      data: isShareVisitorInit(initialState)
        ? buildPublicInitEventData(initialState)
        : initialState,
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

    const isShareEnd = isShareVisitorEnd(finalState);
    // `errorType`/`reasonDetail` both read `finalState.error` — the same
    // `formatErrorForState` shape `sanitizeVisitorError` projects for
    // `toVisitorMessage` — but land as SIBLINGS of `finalState` on
    // `endEventData` below, so `buildPublicEndEventData`'s wholesale
    // `finalState` drop does not touch them. For a share-visitor run, run the
    // SAME classification here rather than trusting the raw `reasonDetail`
    // the caller (`AgentRuntimeService/CompletionLifecycle`, sibling-owned)
    // passed in — this Gateway push is the enforcement boundary regardless of
    // what upstream already computed from the unredacted error.
    const rawErrorType = finalState?.error?.type ?? finalState?.error?.errorType;
    const safeError = isShareEnd
      ? sanitizeVisitorError(
          rawErrorType === undefined
            ? undefined
            : ({ message: finalState?.error?.message, type: rawErrorType } as ChatMessageError),
        )
      : undefined;
    const effectiveReasonDetail = isShareEnd
      ? safeError?.message || getDefaultReasonDetail(undefined, reason)
      : reasonDetail || getDefaultReasonDetail(finalState, reason);
    const errorType = isShareEnd ? safeError?.type : rawErrorType;

    // `finalState` already tells us definitively whether this is a share run,
    // so record it before pushing — covers the case where `publishAgentRuntimeEnd`
    // runs in a process that never saw this op's `publishAgentRuntimeInit`
    // (e.g. queue mode) without waiting on the async metadata resolver.
    if (isShareEnd) {
      this.shareVisitorOps.add(operationId);
    }
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
      data: isShareEnd ? buildPublicEndEventData(endEventData) : endEventData,
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
    const knownShare = this.isShareVisitorKnown(operationId);
    const isShareRun =
      knownShare !== undefined ? knownShare : await this.resolveShareVisitor(operationId);

    // Mirror the Redis publisher's chokepoint — strip
    // `finalState.messages` + tool-set fields off the gateway WS push
    // payload too. The gateway forwards events verbatim to clients, and
    // downstream consumers don't read these fields, so carrying them
    // would re-introduce the same multi-megabyte serialization that
    // crashed the xadd path. Additionally, for a shared-agent visitor run,
    // drop `finalState` wholesale and scrub `uiMessages` instead — see
    // `sanitizeGatewayEventData`.
    const sanitizedEvent =
      event.data === undefined
        ? event
        : { ...event, data: sanitizeGatewayEventData(event.data, isShareRun, event.type) };
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
   * worker resolver is configured AND this op's status hasn't been resolved
   * yet (its first event, in a process that never ran its init) — the caller
   * must then fall back to the async `resolveShareVisitor`.
   *
   * Without a configured resolver (non-queue mode), an unresolved op is
   * treated as `false` synchronously rather than going through the async
   * path at all — this keeps `pushEvent`'s common-case prefix (including this
   * check) fully synchronous, matching `mirrorTargets.get`'s behavior and the
   * `stream_end` await-ordering contract on `publishStreamEvent`. It's also
   * the correct default: without a resolver this notifier only ever sees
   * events for ops it initialized itself, and init marks resolved
   * synchronously before any event is pushed, so reaching here unresolved
   * means this is a normal run whose init this process simply didn't observe
   * (e.g. a unit test calling `publishStreamEvent` directly).
   */
  private isShareVisitorKnown(operationId: string): boolean | undefined {
    if (this.shareVisitorOps.has(operationId)) return true;
    if (this.shareVisitorResolved.has(operationId)) return false;
    if (!this.resolvePersistedShareVisitor) return false;
    return undefined;
  }

  /**
   * Resolve and cache whether an op is a shared-agent visitor run, from
   * persisted metadata (`streamOwnerUserId`). Only reached when a resolver is
   * configured and the op is still unresolved (see `isShareVisitorKnown`).
   * Deduped so concurrent events for the same unresolved op share one
   * metadata read.
   *
   * Fails closed: a resolution error returns `true` (sanitize) rather than
   * risk leaking the creator's identity, and deliberately does NOT cache that
   * outcome as resolved, so the next event retries once the transient failure
   * clears.
   */
  private resolveShareVisitor(operationId: string): Promise<boolean> {
    if (!this.resolvePersistedShareVisitor) return Promise.resolve(false);

    let pending = this.shareVisitorResolving.get(operationId);
    if (!pending) {
      pending = this.resolvePersistedShareVisitor(operationId)
        .then((isShare) => {
          this.shareVisitorResolved.add(operationId);
          this.shareVisitorResolving.delete(operationId);
          if (isShare) this.shareVisitorOps.add(operationId);
          return isShare;
        })
        .catch(() => {
          this.shareVisitorResolving.delete(operationId);
          return true;
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
