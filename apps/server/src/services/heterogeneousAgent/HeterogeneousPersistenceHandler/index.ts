import { type AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type {
  MainAgentIntent,
  MainAgentReduceCtx,
  SubagentIntent,
} from '@lobechat/heterogeneous-agents';
import { getEventScope, reduceMainAgent } from '@lobechat/heterogeneous-agents';
import { isEchoedErrorText } from '@lobechat/heterogeneous-agents/errors';
import { isHeteroStatusGuideErrorData } from '@lobechat/heterogeneous-agents/processFailure';
import { createNanoId } from '@lobechat/utils';
import debug from 'debug';

import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';

import { persistCodexTurnProvenance } from '../heteroProvenance';
import { applyMainIntent, applySubagentIntent } from './applyIntents';
import { eventKey, operationStates } from './operationState';
import {
  loadOrCreateState,
  recoverLastToolMessageFromDb,
  refreshMainStateFromDb,
  refreshSubagentRunsFromDb,
  refreshToolMessageIndex,
  syncAssistantPointerForAdvancedStep,
} from './stateSync';
import type { HeterogeneousPersistenceHandlerDeps, OperationState } from './types';

export { __resetOperationStatesForTesting, StaleHeteroOperationError } from './operationState';
export type { HeterogeneousPersistenceHandlerDeps } from './types';

const log = debug('lobe-server:hetero-agent:persistence');

const generateThreadId = () => `thd_${createNanoId(16)()}`;

/** A `newStep` carrying `externalSignal` opens a signal turn (a background task's wake-up). */
const opensSignalTurn = (event: AgentStreamEvent): boolean =>
  event.type === 'stream_start' && !!event.data?.newStep && !!event.data?.externalSignal;

/** Subagent turns live in their thread; only main-agent step boundaries name a main assistant. */
const isMainStreamStart = (event: AgentStreamEvent): boolean =>
  event.type === 'stream_start' && getEventScope(event).kind === 'main';

/** The raw text a CLI would have echoed into the answer for this failure. */
const errorEchoText = (error: { body?: Record<string, unknown>; message?: string }): string => {
  const body = error.body ?? {};
  const candidate = [body.stderr, body.message, error.message].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );

  return candidate ?? '';
};

/**
 * Server-side persistence for `lh hetero exec` event streams. Mirrors the
 * desktop renderer's `executeHeterogeneousAgent` (1.8k lines) for the DB
 * concerns only — IPC, store dispatch, notifications, refresh hooks all
 * live host-side and are intentionally absent here.
 *
 * Phase 2b scope:
 *
 *   1. 3-phase tool persist (assistant.tools[] pre-register → tool message
 *      create → backfill `result_msg_id`)
 *   2. Subagent thread + per-turn assistant chaining + finalize on parent
 *      tool_result
 *   3. Step boundary handling (new assistant per `stream_start { newStep }`)
 *   4. Per-turn metadata persistence (`step_complete` w/ `phase=turn_metadata`)
 *   5. Final content / reasoning flush on `agent_runtime_end` / `error`
 *
 * Failure semantics (differs from the renderer's optimistic UI posture):
 *
 *   - DB writes propagate exceptions instead of swallowing them. A throw
 *     bubbles to `ingest`, leaving the offending event un-marked in
 *     `processedKeys` so the BatchIngester's outer retry replays it.
 *     Idempotent state updates (per-tool `persistedIds`, payload de-dup,
 *     `ThreadModel.onConflictDoNothing`) make replays safe.
 *   - Renderer-only "log + continue" no longer applies — the server is
 *     authoritative for cloud runs, so silent partial writes would diverge
 *     DB from what the WS subscribers see.
 *
 * Multi-replica caveat: state is per-Node-process. Cloud sandbox routing
 * must be sticky to a single replica per operationId, otherwise turn
 * boundaries on the second replica would lose the chain-parent and
 * pre-existing tool map. (Phase 3 sandbox owns the endpoint per-instance,
 * so this is not a problem in practice.)
 */
export class HeterogeneousPersistenceHandler {
  private readonly deps: HeterogeneousPersistenceHandlerDeps;

  constructor(deps: HeterogeneousPersistenceHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Process a batch of events for an operation. Sequential within the batch.
   *
   * Idempotency contract: an event is marked `processed` ONLY after its
   * handler resolves cleanly. If a handler throws, the event stays unmarked
   * so a follow-up retry processes it again, and the throw bubbles to
   * `heteroIngest` → tRPC → BatchIngester so the producer re-sends. Events
   * that already succeeded earlier in the batch are skipped on retry via
   * the dedupe map, so the retry only re-runs the failed event onward.
   */
  async ingest(params: {
    assistantMessageId?: string;
    events: AgentStreamEvent[];
    operationId: string;
    topicId: string;
  }): Promise<void> {
    const state = await loadOrCreateState(
      this.deps,
      params.operationId,
      params.topicId,
      params.assistantMessageId,
    );
    const batchMaxStepIndex = Math.max(...params.events.map((event) => event.stepIndex));

    // A different Lambda may have already processed `stream_start { newStep }`
    // and persisted `heteroCurrentMsgId` for this operation. Warm instances keep
    // their operation state in memory, so without an explicit resync they would
    // keep appending later-step chunks to the PREVIOUS assistant row. Only resync
    // when the incoming batch advances beyond the step this instance has seen.
    if (batchMaxStepIndex > state.lastStepIndex) {
      await syncAssistantPointerForAdvancedStep(this.deps, state);
    }

    await refreshToolMessageIndex(this.deps, state);
    await refreshMainStateFromDb(this.deps, state);
    await refreshSubagentRunsFromDb(this.deps, state);
    // Only a batch that opens a signal turn needs the tool anchor; skip the
    // lookup for the rest.
    if (params.events.some(opensSignalTurn)) {
      await recoverLastToolMessageFromDb(this.deps, state);
    }

    for (const event of params.events) {
      const key = eventKey(event);
      if (state.processedKeys.has(key)) {
        log('skip duplicate event %s op=%s', key, state.operationId);
        continue;
      }

      // NOTE: do NOT mark `processed` before the handler runs. Marking up
      // front would silently swallow event-level failures — the BatchIngester
      // would ack OK while DB state diverges from the renderer's view. Mark
      // only on success so a retry can complete the lost write.
      await this.handleEvent(state, event);
      if (isMainStreamStart(event)) {
        state.streamStartAssistantIds.set(key, state.main.currentAssistantId);
      }
      state.processedKeys.add(key);
      state.lastStepIndex = Math.max(state.lastStepIndex, event.stepIndex);
    }

    // Flush accumulated content after every batch so a subsequent replica
    // picking up this operation always sees the latest content in the DB,
    // even if it never processes a step boundary or terminal event.
    await this.flushBatchContent(state);
  }

  /**
   * Events of the batch not yet successfully published to the live stream.
   * See `OperationState.publishedKeys` for why this gate is separate from
   * the persistence dedupe. Without state (already finished, or a retry on
   * a cold replica) every event is treated as unpublished — degrading to
   * republish-all. Main-agent text/reasoning survive that via their
   * `replace`-snapshot seq guards; the accepted cross-replica residuals are
   * subagent text (append semantics), tool lifecycle replays (benign client
   * upserts), and a duplicate trace fold — closing those needs a durable
   * publish identity (tracked follow-up), not a bigger in-memory map.
   */
  filterUnpublishedEvents(operationId: string, events: AgentStreamEvent[]): AgentStreamEvent[] {
    const state = operationStates.get(operationId);
    if (!state) return events;

    return events.filter((event) => !state.publishedKeys.has(eventKey(event)));
  }

  /**
   * Wire `data` for an event about to be published.
   *
   * A main-agent `stream_start` carries the assistant row it resolved to as
   * `assistantMessage.id`. CLI adapters never know the server's message ids,
   * so without it a subscriber can only infer each step's row from where it
   * started. A reconnect starts from `runningOperation.assistantMessageId`,
   * the newest row, so its full replay wrote every earlier step onto that row.
   * Without state (a retry on a cold replica) the event goes out unchanged
   * and the client falls back to its DB lookup.
   */
  publishData(operationId: string, event: AgentStreamEvent): AgentStreamEvent['data'] {
    const assistantId = operationStates
      .get(operationId)
      ?.streamStartAssistantIds.get(eventKey(event));
    if (!assistantId) return event.data;

    return { ...event.data, assistantMessage: { id: assistantId } };
  }

  /** Latch an event as published so a batch retry skips its XADD. */
  markEventPublished(operationId: string, event: AgentStreamEvent): void {
    const state = operationStates.get(operationId);
    if (!state) return;

    const key = eventKey(event);
    state.publishedKeys.add(key);
    state.streamStartAssistantIds.delete(key);
  }

  /**
   * Flush trailing accumulators and drop the per-operation state.
   *
   * Resume id source: CC's `--resume <sessionId>` token comes from the
   * adapter's cached `system:init.session_id`. The heterogeneous-agent service
   * settles topic-level resume ownership after this flush.
   *
   * Use when:
   * - A heterogeneous operation reaches a terminal producer callback.
   *
   * Expects:
   * - The operation state was created by ingest or can be bootstrapped from the topic marker.
   *
   * Returns:
   * - A promise that resolves after any finish-only error is projected and state is released.
   */
  async finish(params: {
    assistantMessageId?: string;
    error?: { body?: Record<string, unknown>; message: string; type: string };
    operationId: string;
    result: 'success' | 'error' | 'cancelled';
    /**
     * Needed to bootstrap state for a failed run that never ingested: a
     * process-level failure (spawn ENOENT, auth printed straight to stderr)
     * produces ZERO stream events, so no ingest ever created an
     * `OperationState` for this op.
     */
    topicId?: string;
  }): Promise<void> {
    let state = operationStates.get(params.operationId);

    // A run that died before producing any stream event has no state — but its
    // terminal error must still land on the assistant message HERE, before the
    // caller publishes `agent_runtime_end`. The client refetches messages on
    // that event, so deferring the write to CompletionLifecycle (which runs
    // after the publish) races the refetch and the error card doesn't render
    // live. Bootstrap from topic.metadata.runningOperation like ingest does;
    // a stale/mismatched operation stays a no-op.
    if (!state && params.topicId) {
      try {
        state = await loadOrCreateState(
          this.deps,
          params.operationId,
          params.topicId,
          params.assistantMessageId,
          true,
        );
      } catch (error) {
        log(
          'finish bootstrap failed op=%s topic=%s err=%O',
          params.operationId,
          params.topicId,
          error,
        );
        return;
      }
    }
    if (!state) return;

    try {
      // A producer may finish without ingesting its final stream event. Close
      // its pending questions before the caller publishes runtime_end. Refresh
      // only the intervention projection: finish must not flush stale text.
      await refreshToolMessageIndex(this.deps, state);
      const terminal = reduceMainAgent(
        state.main,
        { type: 'agent_runtime_end' },
        this.mainReduceCtx(state),
      );
      for (const intent of terminal.intents) {
        if (intent.kind === 'setToolIntervention') {
          await applyMainIntent(this.deps, state, intent, state.lastStepIndex);
        }
      }
      if (params.error) await this.persistFinishError(state, params.error);
    } finally {
      operationStates.delete(params.operationId);
    }
  }

  /**
   * Persist the CLI's native session id onto `topic.metadata.heteroSessionId`.
   * `TopicModel.updateMetadata` merges into existing JSONB so this does NOT
   * clobber `runningOperation` / `workingDirectory` / other peer fields.
   */
  private async persistSessionId(topicId: string, sessionId: string): Promise<void> {
    try {
      await this.deps.topicModel.updateMetadata(topicId, { heteroSessionId: sessionId });
      log('persisted sessionId topic=%s sessionId=%s', topicId, sessionId);
    } catch (err) {
      log('persistSessionId failed topic=%s err=%O', topicId, err);
    }
  }

  // ─── Event dispatch ──────────────────────────────────────────────────────

  private async handleEvent(state: OperationState, event: AgentStreamEvent): Promise<void> {
    await this.reduceAndApply(state, event);
  }

  // ─── Main-agent reducer interpreter ──────────────────────────────────────

  private mainReduceCtx(state: OperationState): MainAgentReduceCtx {
    return {
      agentId: state.agentId,
      newId: (kind) => (kind === 'thread' ? generateThreadId() : `msg_${createNanoId(18)()}`),
      toolMessageIds: state.toolMsgIdByCallId,
      topicId: state.topicId,
    };
  }

  /**
   * Single reducer entry point for the server persistence path. The reducer owns
   * both the main thread and nested subagent runs; this interpreter only applies
   * declarative intents to DB models. State commits after every intent succeeds,
   * so a failing DB write leaves the event unmarked and the BatchIngester retry
   * replays it against the previous reducer state.
   */
  private async reduceAndApply(state: OperationState, event: AgentStreamEvent) {
    // Capture the CC-native session id off the stream_start stream so every
    // message persisted below carries the session it belongs to. Stable per
    // run; the copy is what makes a mid-topic session fork detectable.
    if (event.type === 'stream_start') {
      const sid = (event.data as { sessionId?: string } | undefined)?.sessionId;
      if (typeof sid === 'string' && sid.length > 0 && sid !== state.heteroSessionId) {
        state.heteroSessionId = sid;
        // Persist the resume token the moment CC reports it, not only on a clean
        // `finish()`. A stuck run is abandoned by the inactivity watchdog via
        // AbandonOperationService, which never calls finish() — so a run that
        // produced a valid session id but got killed before finishing would
        // otherwise leave `topic.metadata.heteroSessionId` empty, forcing the
        // next turn to spawn a fresh CC session and drop all `--resume` history.
        // Writing it here makes resume survive abandon. The terminal service
        // path may still overwrite it after verifying topic ownership.
        await this.persistSessionId(state.topicId, sid);
      }
    }

    if (event.type === 'stream_start' && typeof event.data?.codexTurnId === 'string') {
      state.codexTurnId = event.data.codexTurnId;
      await persistCodexTurnProvenance(this.deps.messageModel, state);
    }

    const { intents, state: next } = reduceMainAgent(state.main, event, this.mainReduceCtx(state));

    for (const intent of intents) {
      if ('threadId' in intent) {
        await applySubagentIntent(this.deps, state, intent as SubagentIntent);
      } else {
        await applyMainIntent(this.deps, state, intent as MainAgentIntent, event.stepIndex);
      }
    }

    state.main = next;
  }

  /**
   * Persist an error supplied only by `heteroFinish` without rewriting streamed content.
   *
   * `heteroIngest` is the single writer for content and reasoning. A finish request can
   * reach a warm serverless replica whose accumulator predates a newer snapshot written
   * by another replica; replaying that accumulator here would roll the final answer back.
   */
  private async persistFinishError(
    state: OperationState,
    error: { body?: Record<string, unknown>; message: string; type: string },
  ) {
    const updateValue: Record<string, any> = {};
    const clearsEcho = error.body?.clearEchoedContent === true;
    // One read serves both decisions below.
    const persisted =
      clearsEcho || !isHeteroStatusGuideErrorData(error.body)
        ? await this.deps.messageModel.findById(state.main.currentAssistantId)
        : undefined;
    // `clearEchoedContent` marks an error the CLI may ALSO have printed into
    // the answer — it does not mean the answer is disposable. Quota rejections
    // carry the flag too, and a run that worked for ten minutes before its
    // weekly window closed must keep what it wrote, so only an exact echo is
    // dropped (same rule as the client and the coordinator reducer).
    if (clearsEcho && isEchoedErrorText(persisted?.content, errorEchoText(error))) {
      updateValue.content = '';
    }
    // Same canonical normalization as the in-stream `setError` path — the CLI's
    // free-form `{ message, type }` runs through formatErrorForState so the
    // finish-only write and the in-stream write produce one classified error shape.
    // A structured `body` (status-guide error: agentType + code) passes
    // through untouched — the client's guide UI gates on it.
    //
    // Never DOWNGRADE, though: the in-stream `setError` path may already have
    // persisted the adapter's classified status-guide error on this assistant,
    // while older CLIs flatten the finish error to a bare `{ message }`.
    // Overwriting would demote the client from the dedicated guide card to
    // the generic error alert — keep the richer persisted error instead.
    const overwritesGuideError =
      !isHeteroStatusGuideErrorData(error.body) &&
      isHeteroStatusGuideErrorData(persisted?.error?.body);
    if (!overwritesGuideError) updateValue.error = formatErrorForState(error);

    if (Object.keys(updateValue).length > 0) {
      await this.deps.messageModel.update(state.main.currentAssistantId, updateValue);
    }
  }

  /**
   * Write accumulated content/reasoning to DB after every ingest batch.
   * This ensures a subsequent replica always finds the latest text in the DB
   * even if the current replica never processes a step-boundary or terminal
   * event (which are the normal flush triggers).
   */
  private async flushBatchContent(state: OperationState): Promise<void> {
    if (!state.main.accContent && !state.main.accReasoning) return;
    const update: Record<string, any> = {};
    if (state.main.accContent) update.content = state.main.accContent;
    if (state.main.accReasoning) update.reasoning = { content: state.main.accReasoning };
    // The first assistant is seeded before the heterogeneous operation exists.
    // Stamp every durable main reply so ordinary completion lookups stay scoped to this run.
    update.metadata = {
      ...state.main.turnMetadata,
      operationId: state.operationId,
    };
    await this.deps.messageModel.update(state.main.currentAssistantId, update);
  }
}
