import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { LOADING_FLAT } from '@lobechat/const';
import type {
  MainAgentIntent,
  MainAgentReduceCtx,
  MainAgentRunState,
  MainAgentTurnToolState,
  SubagentIntent,
  SubagentRunSnapshot,
  ToolCallPayload,
} from '@lobechat/heterogeneous-agents';
import {
  createMainAgentRunState,
  reduceMainAgent,
  rehydrateSubagentRunsState,
} from '@lobechat/heterogeneous-agents';
import {
  AgentRuntimeErrorType,
  type ChatMessageError,
  type ChatToolPayload,
  ThreadStatus,
  ThreadType,
} from '@lobechat/types';
import { createNanoId } from '@lobechat/utils';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import type { ThreadModel } from '@/database/models/thread';
import type { TopicModel } from '@/database/models/topic';

const log = debug('lobe-server:hetero-agent:persistence');

const generateThreadId = () => `thd_${createNanoId(16)()}`;

/**
 * Stable 32-bit FNV-1a hash of a string. Cheap to compute, collision odds are
 * negligible at this scope (a few thousand events per operation), and the
 * output is short enough to keep the per-operation `processedKeys` set small.
 */
const fnv1a = (input: string): string => {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // FNV prime 0x01000193, applied via bit shifts to stay in 32-bit math.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(36);
};

/**
 * Per-event idempotency key. CLI BatchIngester retries the SAME event objects
 * on transient failures, so the same `(stepIndex, type, data)` triple is
 * stable across retries — and distinct between back-to-back events even when
 * they share a millisecond timestamp.
 *
 * Why not just `(stepIndex, type, timestamp)`: producers stamp events with
 * `Date.now()` (see `claudeCode.ts` / `codex.ts` adapters), and CC bursts
 * multiple `stream_chunk` events through the same step within a single
 * millisecond. Without a content fingerprint, later chunks would collide with
 * earlier ones, get treated as duplicates, and be dropped — silently
 * truncating assistant output.
 *
 * Why not hash full `data`: tools_calling payloads can carry large argument
 * strings; a stable JSON.stringify on every event is cheap enough but the
 * resulting key would balloon the `processedKeys` set. Hashing keeps the key
 * bounded.
 */
const eventKey = (event: AgentStreamEvent): string => {
  // Fingerprint the data via stable JSON. Order is irrelevant — adapters
  // produce events with consistent key order, and even if they didn't, the
  // important property is "same event input → same output", which holds.
  const dataJson = (() => {
    try {
      return JSON.stringify(event.data ?? null);
    } catch {
      // Cyclic / unstringifiable payload: fall back to a coarse fingerprint.
      // Real wire data is always JSON-serializable, so this branch only fires
      // on bad test inputs.
      return String(typeof event.data);
    }
  })();
  return `${event.stepIndex}:${event.type}:${event.timestamp}:${fnv1a(dataJson)}`;
};

interface AssistantDbSnapshot {
  content: string;
  metadata: Record<string, any>;
  model: string | undefined;
  parentId: string | null | undefined;
  provider: string | undefined;
  reasoning: string;
  textSnapshotSeq: number;
  tools: ChatToolPayload[];
}

interface AssistantMessageDbLike {
  content?: unknown;
  metadata?: Record<string, any> | null;
  model?: string;
  parentId?: string | null;
  provider?: string;
  reasoning?: { content?: string } | null;
  tools?: ChatToolPayload[] | null;
}

/**
 * Per-operation in-memory state. Lifetime spans the whole CLI run from first
 * `heteroIngest` batch through `heteroFinish`. Main-agent state is projected
 * back from DB at each ingest boundary; active subagent run state is still the
 * in-memory part of the operation.
 */
interface OperationState {
  agentId: string | null;
  lastStepIndex: number;
  main: MainAgentRunState;
  operationId: string;
  processedKeys: Set<string>;
  /**
   * Run-global DB index for every tool message in the topic, keyed by
   * `tool_call_id`. Main and subagent reducers keep only their per-turn maps;
   * this map lets a `tool_result` land even when its `tools_calling` was
   * reduced by another serverless replica.
   */
  toolMsgIdByCallId: Map<string, string>;
  topicId: string;
}

/**
 * Module-level singleton: `Map<operationId, OperationState>`. Service
 * instances are constructed per-request via the tRPC procedure middleware,
 * so per-instance state would not survive across requests. Keying off the
 * shared map lets two ingest batches for the same operationId share their
 * tool map / accumulated content / subagent runs.
 */
const operationStates = new Map<string, OperationState>();

/** Test-only reset hook to clear the singleton between specs. */
export const __resetOperationStatesForTesting = () => operationStates.clear();

export class StaleHeteroOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleHeteroOperationError';
  }
}

export interface HeterogeneousPersistenceHandlerDeps {
  messageModel: MessageModel;
  threadModel: ThreadModel;
  topicModel: TopicModel;
}

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
    const state = await this.loadOrCreateState(
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
      await this.syncAssistantPointerForAdvancedStep(state);
    }

    await this.refreshToolMessageIndex(state);
    await this.refreshMainStateFromDb(state);
    await this.refreshSubagentRunsFromDb(state);

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
      state.processedKeys.add(key);
      state.lastStepIndex = Math.max(state.lastStepIndex, event.stepIndex);
    }

    // Flush accumulated content after every batch so a subsequent replica
    // picking up this operation always sees the latest content in the DB,
    // even if it never processes a step boundary or terminal event.
    await this.flushBatchContent(state);
  }

  /**
   * Flush trailing accumulators, persist the CLI's native session id (when
   * present) for next-turn resume, and drop the per-operation state.
   *
   * Resume id source: CC's `--resume <sessionId>` token comes from the
   * adapter's cached `system:init.session_id`. The CLI surfaces it here as a
   * `heteroFinish` argument; we write it to `topic.metadata.heteroSessionId`
   * (the same field the desktop renderer uses), so the next CLI spawn for
   * this topic can include `--resume <id>`.
   */
  async finish(params: {
    error?: { message: string; type: string };
    operationId: string;
    result: 'success' | 'error' | 'cancelled';
    sessionId?: string;
  }): Promise<void> {
    const state = operationStates.get(params.operationId);
    if (!state) return;

    try {
      await this.flushFinalState(state, params.error, params.result);
      if (params.sessionId) {
        await this.persistSessionId(state.topicId, params.sessionId);
      } else if (params.result === 'error') {
        // No new session id was produced and the run failed. The most common
        // cause in cloud sandboxes is `--resume <staleId>` failing because the
        // container was recycled and session files are gone. Clear any persisted
        // `heteroSessionId` so the next turn starts a fresh CC session instead
        // of looping on the same stale id.
        //
        // When CC ran (system.init was emitted) but produced an error result,
        // `params.sessionId` is set — so this branch is NOT reached and the
        // valid session id is kept for resume on the next turn.
        await this.clearSessionId(state.topicId);
      }
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

  /**
   * Remove a stale `heteroSessionId` from topic metadata. Called when a run
   * fails without producing a new session id (e.g. `--resume` rejected because
   * the sandbox was recycled). Prevents the next turn from inheriting a session
   * id that will never succeed.
   */
  private async clearSessionId(topicId: string): Promise<void> {
    try {
      await this.deps.topicModel.updateMetadata(topicId, { heteroSessionId: undefined });
      log('cleared stale sessionId topic=%s', topicId);
    } catch (err) {
      log('clearSessionId failed topic=%s err=%O', topicId, err);
    }
  }

  // ─── State management ────────────────────────────────────────────────────

  private async loadOrCreateState(
    operationId: string,
    topicId: string,
    seedAssistantMessageId?: string,
  ): Promise<OperationState> {
    let state = operationStates.get(operationId);
    if (state) {
      // Defensive: caller mismatch on topicId would corrupt persistence —
      // assert and throw rather than silently writing to the wrong topic.
      if (state.topicId !== topicId) {
        throw new Error(
          `Operation ${operationId} is already bound to topic ${state.topicId}, not ${topicId}`,
        );
      }
      return state;
    }

    const topic = await this.deps.topicModel.findById(topicId);
    const running = topic?.metadata?.runningOperation;

    if (!running) {
      throw new StaleHeteroOperationError(
        `Stale hetero operation ${operationId} on topic ${topicId}; no active runningOperation`,
      );
    }

    if (running.operationId !== operationId) {
      throw new StaleHeteroOperationError(
        `Stale hetero operation ${operationId} on topic ${topicId}; current operation is ${running.operationId}`,
      );
    }

    // Prefer the assistantMessageId forwarded in the ingest payload (sandbox path).
    // The orchestrator already has it in-memory and passes it through env → CLI → tRPC,
    // so this path avoids depending on `runningOperation.assistantMessageId`
    // itself being readable on this replica. We still require the topic's
    // runningOperation binding to match `operationId`, otherwise late/retried
    // batches after finish could keep mutating a completed turn.
    // Fall back to topic.metadata for desktop / old-CLI callers that lack the field.
    const baseAssistantMessageId = seedAssistantMessageId ?? running.assistantMessageId;

    if (!baseAssistantMessageId) {
      throw new Error(`runningOperation on topic ${topicId} is missing assistantMessageId`);
    }

    if (seedAssistantMessageId) {
      const seededMsg = await this.deps.messageModel.findById(seedAssistantMessageId);
      if (!seededMsg) {
        throw new Error(
          `Seeded assistantMessageId ${seedAssistantMessageId} was not found for topic ${topicId}`,
        );
      }
      if (seededMsg.topicId !== topicId) {
        throw new Error(
          `Seeded assistantMessageId ${seedAssistantMessageId} does not belong to topic ${topicId}`,
        );
      }
    }

    // Prefer the latest step's assistant message id (written by handleStepStart)
    // over the initial placeholder — so a new replica after a step boundary uses
    // the correct message rather than the stale initial one.
    // Guard: only use heteroCurrentMsgId when it belongs to THIS operation.
    // A stale value from a previous run must not override the new operation's
    // seeded assistantMessageId (P1 fix).
    const stored = topic?.metadata?.heteroCurrentMsgId;
    const currentAssistantMessageId =
      stored?.operationId === operationId
        ? (stored.msgId ?? baseAssistantMessageId)
        : baseAssistantMessageId;

    state = {
      agentId: topic?.agentId ?? null,
      lastStepIndex: 0,
      main: createMainAgentRunState(currentAssistantMessageId),
      operationId,
      processedKeys: new Set(),
      toolMsgIdByCallId: new Map(),
      topicId,
    };
    await this.refreshToolMessageIndex(state);
    await this.refreshMainStateFromDb(state);
    operationStates.set(operationId, state);
    log(
      'created state for operation %s on topic %s msgId=%s tools=%d restored(content=%d tools=%d)',
      operationId,
      topicId,
      currentAssistantMessageId,
      state.toolMsgIdByCallId.size,
      state.main.accContent.length,
      state.main.toolState.payloads.length,
    );
    return state;
  }

  private createEmptyMainToolState(): MainAgentTurnToolState {
    return { payloads: [], persistedIds: new Set(), toolMsgIdByCallId: new Map() };
  }

  private toAssistantSnapshot(
    message: AssistantMessageDbLike | null | undefined,
  ): AssistantDbSnapshot {
    const rawContent = (message?.content ?? '') as string;
    const metadata = ((message?.metadata as Record<string, any> | null) ?? {}) as Record<
      string,
      any
    >;
    const textSnapshotSeq = Number(metadata.heteroTextSnapshotSeq ?? 0);
    return {
      content: rawContent === LOADING_FLAT ? '' : rawContent,
      metadata,
      model: message?.model,
      parentId: message?.parentId,
      provider: message?.provider,
      reasoning: (message?.reasoning as { content?: string } | null)?.content ?? '',
      textSnapshotSeq: Number.isFinite(textSnapshotSeq) ? textSnapshotSeq : 0,
      tools: (message?.tools ?? []) as ChatToolPayload[],
    };
  }

  private toToolPayload(tool: ChatToolPayload): ToolCallPayload {
    return {
      apiName: tool.apiName,
      arguments: tool.arguments,
      id: tool.id,
      identifier: tool.identifier,
      type: tool.type,
    };
  }

  private buildMainToolStateFromSnapshot(
    snapshot: AssistantDbSnapshot,
    toolMsgIdByCallId: Map<string, string>,
  ): MainAgentTurnToolState {
    const toolState = this.createEmptyMainToolState();
    const seen = new Set<string>();

    for (const tool of snapshot.tools) {
      if (!tool.id || seen.has(tool.id)) continue;
      const toolMessageId = tool.result_msg_id ?? toolMsgIdByCallId.get(tool.id);
      if (!toolMessageId) continue;

      seen.add(tool.id);
      toolState.payloads.push(this.toToolPayload(tool));
      toolState.persistedIds.add(tool.id);
      toolState.toolMsgIdByCallId.set(tool.id, toolMessageId);
    }

    return toolState;
  }

  private getLastSnapshotToolMessageId(
    snapshot: AssistantDbSnapshot,
    toolMsgIdByCallId: Map<string, string>,
  ): string | undefined {
    for (const tool of [...snapshot.tools].reverse()) {
      const toolMessageId = tool.result_msg_id ?? toolMsgIdByCallId.get(tool.id);
      if (toolMessageId) return toolMessageId;
    }
    return undefined;
  }

  private async refreshToolMessageIndex(state: OperationState): Promise<void> {
    const toolPlugins = await this.deps.messageModel.listMessagePluginsByTopic(state.topicId);
    for (const plugin of toolPlugins) {
      if (plugin.toolCallId) state.toolMsgIdByCallId.set(plugin.toolCallId, plugin.id);
    }
  }

  private async getLastChildToolMessageId(assistantMessageId: string): Promise<string | undefined> {
    return await this.deps.messageModel.getLastChildToolMessageId?.(assistantMessageId);
  }

  /**
   * Rehydrate reducer state from the DB projection of the current assistant.
   * This preserves the shared pure reducer as the single state machine while
   * keeping the serverless-specific "another replica already wrote this"
   * recovery outside the package.
   */
  private async refreshMainStateFromDb(state: OperationState): Promise<void> {
    const currentMsg = await this.deps.messageModel.findById(state.main.currentAssistantId);
    const snapshot = this.toAssistantSnapshot(currentMsg);

    if (snapshot.textSnapshotSeq > state.main.lastTextSnapshotSeq) {
      state.main.accContent = snapshot.content;
      state.main.lastTextSnapshotSeq = snapshot.textSnapshotSeq;
      state.main.turnMetadata = snapshot.metadata;
    } else {
      if (snapshot.content.length > state.main.accContent.length) {
        state.main.accContent = snapshot.content;
      }
      if (
        Object.keys(state.main.turnMetadata).length === 0 &&
        Object.keys(snapshot.metadata).length > 0
      ) {
        state.main.turnMetadata = snapshot.metadata;
      }
    }

    if (snapshot.reasoning.length > state.main.accReasoning.length) {
      state.main.accReasoning = snapshot.reasoning;
    }

    const dbToolState = this.buildMainToolStateFromSnapshot(snapshot, state.toolMsgIdByCallId);
    for (const [toolCallId, toolMessageId] of dbToolState.toolMsgIdByCallId) {
      state.toolMsgIdByCallId.set(toolCallId, toolMessageId);
    }
    if (
      dbToolState.payloads.length > state.main.toolState.payloads.length ||
      dbToolState.persistedIds.size > state.main.toolState.persistedIds.size
    ) {
      state.main.toolState = dbToolState;
    }

    if (snapshot.model) state.main.turnModel = snapshot.model;
    if (snapshot.provider) state.main.turnProvider = snapshot.provider;

    // Prefer the authoritative child tool row over the assistant.tools[] JSONB
    // mirror. During multi-tool batches, an earlier tool may already have
    // result_msg_id backfilled while a later tool row exists but Phase 3 has not
    // rewritten the JSONB payload yet; anchoring from the snapshot would pick
    // the earlier tool and fork the main wire.
    const currentTurnToolId =
      (await this.getLastChildToolMessageId(state.main.currentAssistantId)) ??
      this.getLastSnapshotToolMessageId(snapshot, state.toolMsgIdByCallId);
    if (currentTurnToolId) {
      state.main.lastToolMsgIdEver = currentTurnToolId;
      return;
    }

    const toolMessageIds = new Set(state.toolMsgIdByCallId.values());
    if (snapshot.parentId && toolMessageIds.has(snapshot.parentId)) {
      state.main.lastToolMsgIdEver = snapshot.parentId;
    }
  }

  /**
   * Rebuild the in-flight subagent runs (`state.main.subagents`) from DB.
   *
   * The shared reducer keys runs by `parentToolCallId` and only lazy-creates a
   * thread when the run is ABSENT from this map. On a cold serverless replica
   * `createMainAgentRunState` seeds an empty map, so a subagent event whose
   * thread already exists (created by an earlier batch / another replica) would
   * fork a brand-new thread — the "大量无意义的 Subagent" bug. `refreshMainStateFromDb`
   * rebuilds the main-agent half; this rebuilds the subagent half the same way.
   *
   * Merge semantics: only runs MISSING from the in-memory map are rehydrated, so
   * a warm replica's live per-turn accumulators (`accContent`, current
   * `toolState`) are never clobbered by the DB projection. Finalized runs are
   * excluded (their thread is `Active`, not `Processing`), so a completed spawn
   * is never resurrected.
   *
   * Best-effort: any DB hiccup (or a partial test mock without the query
   * methods) leaves `state.main.subagents` untouched rather than aborting the
   * whole ingest.
   */
  private async refreshSubagentRunsFromDb(state: OperationState): Promise<void> {
    try {
      const threads = await this.deps.threadModel.queryByTopicId(state.topicId);
      const existing = state.main.subagents.runs;
      const snapshots: SubagentRunSnapshot[] = [];

      for (const thread of threads ?? []) {
        if (thread.type !== ThreadType.Isolation) continue;
        if (thread.status !== ThreadStatus.Processing) continue;
        const meta = thread.metadata as { operationId?: string; sourceToolCallId?: string } | null;
        // Operation-scoped: only rehydrate threads THIS operation created.
        // Topics are reused across turns, so a prior run that crashed / was
        // cancelled without an ingested terminal event can leave its subagent
        // thread stuck in `Processing`. Without this guard the next operation
        // would merge that unrelated thread into its reducer state and then
        // finalize/mutate it on its own terminal drain. Threads written before
        // this field existed have no `operationId` and are skipped (safe — we
        // can't attribute them, and the live run re-creates what it needs).
        if (meta?.operationId !== state.operationId) continue;
        const parentToolCallId = meta?.sourceToolCallId;
        if (!parentToolCallId || existing.has(parentToolCallId)) continue;

        const messages = await this.deps.messageModel.query({
          threadId: thread.id,
          topicId: state.topicId,
        });
        const snapshot = this.buildSubagentSnapshot(parentToolCallId, thread.id, messages);
        if (snapshot) snapshots.push(snapshot);
      }

      if (snapshots.length === 0) return;

      // Union: rehydrated (missing) runs + the in-memory ones (which win, since
      // they carry live accumulators the DB hasn't caught up to yet).
      const merged = rehydrateSubagentRunsState(snapshots);
      for (const [parentToolCallId, run] of existing) merged.runs.set(parentToolCallId, run);
      state.main = { ...state.main, subagents: merged };
    } catch (err) {
      log('refreshSubagentRunsFromDb failed op=%s err=%O', state.operationId, err);
    }
  }

  /**
   * Reconstruct one {@link SubagentRunSnapshot} from a thread's persisted
   * messages (ordered `createdAt` asc by the query). Returns undefined when the
   * thread has no assistant yet — without one there is nothing to attach a
   * continuation turn to, and the first-event path will (correctly) seed it.
   */
  private buildSubagentSnapshot(
    parentToolCallId: string,
    threadId: string,
    messages: Array<{
      id: string;
      metadata?: Record<string, any> | null;
      parentId?: string | null;
      role: string;
      tool_call_id?: string;
    }>,
  ): SubagentRunSnapshot | undefined {
    const assistants = messages.filter((m) => m.role === 'assistant');
    const currentAssistant = assistants.at(-1);
    if (!currentAssistant) return undefined;

    const toolRows = messages.filter((m) => m.role === 'tool' && m.tool_call_id);
    const childTools = toolRows.filter((m) => m.parentId === currentAssistant.id);
    const lastChainParentId = childTools.at(-1)?.id ?? currentAssistant.id;
    // Recover the in-flight turn's CC message.id so a continuation event is
    // recognized as the SAME turn (no spurious boundary → no fragmentation).
    const currentSubagentMessageId =
      typeof currentAssistant.metadata?.subagentMessageId === 'string'
        ? currentAssistant.metadata.subagentMessageId
        : undefined;

    return {
      currentAssistantId: currentAssistant.id,
      currentSubagentMessageId,
      lastChainParentId,
      lifetimeToolCallIds: toolRows.map((m) => m.tool_call_id!),
      parentToolCallId,
      threadId,
    };
  }

  private async syncAssistantPointerForAdvancedStep(state: OperationState): Promise<void> {
    const topic = await this.deps.topicModel.findById(state.topicId);
    const running = topic?.metadata?.runningOperation;

    if (running && running.operationId !== state.operationId) {
      throw new StaleHeteroOperationError(
        `Stale hetero operation ${state.operationId} on topic ${state.topicId}; current operation is ${running.operationId}`,
      );
    }

    const stored = topic?.metadata?.heteroCurrentMsgId;
    const authoritativeAssistantMessageId =
      stored?.operationId === state.operationId
        ? (stored.msgId ?? running?.assistantMessageId)
        : running?.assistantMessageId;

    if (
      !authoritativeAssistantMessageId ||
      authoritativeAssistantMessageId === state.main.currentAssistantId
    ) {
      return;
    }

    state.main = {
      ...state.main,
      accContent: '',
      accReasoning: '',
      currentAssistantId: authoritativeAssistantMessageId,
      lastTextSnapshotSeq: 0,
      toolState: this.createEmptyMainToolState(),
      turnMetadata: {},
    };
    await this.refreshToolMessageIndex(state);
    await this.refreshMainStateFromDb(state);

    log(
      'synced warm state op=%s to assistant=%s after step advance',
      state.operationId,
      authoritativeAssistantMessageId,
    );
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
    const { intents, state: next } = reduceMainAgent(state.main, event, this.mainReduceCtx(state));

    for (const intent of intents) {
      if ('threadId' in intent) {
        await this.applySubagentIntent(state, intent as SubagentIntent);
      } else {
        await this.applyMainIntent(state, intent as MainAgentIntent);
      }
    }

    state.main = next;
  }

  private async applyMainIntent(state: OperationState, intent: MainAgentIntent) {
    switch (intent.kind) {
      case 'createAssistant': {
        await this.deps.messageModel.create(
          {
            agentId: intent.agentId ?? undefined,
            content: '',
            ...(intent.signal ? { metadata: { signal: intent.signal } } : {}),
            model: intent.model,
            parentId: intent.parentId,
            provider: intent.provider,
            role: 'assistant',
            topicId: intent.topicId ?? state.topicId,
          } as any,
          intent.messageId,
        );

        await this.deps.topicModel.updateMetadata(state.topicId, {
          heteroCurrentMsgId: { msgId: intent.messageId, operationId: state.operationId },
        });
        return;
      }

      case 'persistAssistant': {
        const update: Record<string, any> = {};
        if (intent.content !== undefined) update.content = intent.content;
        if (intent.reasoning !== undefined) update.reasoning = { content: intent.reasoning };
        if (intent.model) update.model = intent.model;
        if (intent.provider) update.provider = intent.provider;
        if (intent.metadata) update.metadata = intent.metadata;
        if (Object.keys(update).length > 0) {
          await this.deps.messageModel.update(intent.messageId, update);
        }
        return;
      }

      // Token-level live updates are renderer-only. The server persists durable
      // snapshots via persistAssistant / persistToolBatch / flushBatchContent.
      case 'streamContent': {
        return;
      }

      case 'persistToolBatch': {
        const buildUpdate = (withResult: boolean) =>
          this.buildToolBatchUpdate(intent.tools, {
            content: intent.content,
            reasoning: intent.reasoning,
            withResult,
          });

        // Phase 1: assistant.tools[] without result_msg_id.
        await this.deps.messageModel.update(intent.assistantMessageId, buildUpdate(false));

        // Phase 2: create new tool rows with reducer-preallocated ids.
        for (const tool of intent.tools) {
          if (!tool.isNew) continue;
          await this.deps.messageModel.create(
            {
              agentId: state.agentId ?? undefined,
              content: '',
              parentId: intent.assistantMessageId,
              plugin: {
                apiName: tool.payload.apiName,
                arguments: tool.payload.arguments,
                identifier: tool.payload.identifier,
                type: tool.payload.type,
              },
              role: 'tool',
              threadId: null,
              tool_call_id: tool.payload.id,
              topicId: state.topicId,
            } as any,
            tool.toolMessageId,
          );
          state.toolMsgIdByCallId.set(tool.payload.id, tool.toolMessageId);
        }

        // Phase 3: backfill result_msg_id.
        await this.deps.messageModel.update(intent.assistantMessageId, buildUpdate(true));
        return;
      }

      case 'resolveToolResult': {
        await this.applyToolResult(state, intent);
        return;
      }

      case 'recordUsage': {
        const update: Record<string, any> = {};
        if (intent.usage !== undefined) {
          update.metadata = { ...state.main.turnMetadata, usage: intent.usage };
        }
        if (intent.model) update.model = intent.model;
        if (intent.provider) update.provider = intent.provider;
        if (Object.keys(update).length > 0) {
          await this.deps.messageModel.update(intent.messageId, update);
        }
        return;
      }

      case 'setError': {
        const update: Record<string, any> = { error: this.toChatMessageError(intent.errorData) };
        if (intent.clearContent) update.content = '';
        await this.deps.messageModel.update(intent.messageId, update);
        return;
      }
    }
  }

  private async applyToolResult(
    state: OperationState,
    intent: {
      content: string;
      isError: boolean;
      pluginState?: Record<string, any>;
      toolCallId: string;
    },
  ) {
    const toolMsgId = state.toolMsgIdByCallId.get(intent.toolCallId);
    if (!toolMsgId) {
      log('tool_result for unknown toolCallId=%s op=%s', intent.toolCallId, state.operationId);
      return;
    }

    await this.deps.messageModel.updateToolMessage(toolMsgId, {
      content: intent.content,
      pluginError: intent.isError ? { message: intent.content } : undefined,
      pluginState: intent.pluginState,
    });
  }

  private buildToolBatchUpdate(
    tools: Array<{ payload: ToolCallPayload; toolMessageId: string }>,
    options: { content?: string; reasoning?: string; withResult: boolean },
  ): Record<string, any> {
    const update: Record<string, any> = {
      tools: tools.map(({ payload, toolMessageId }) =>
        options.withResult ? { ...payload, result_msg_id: toolMessageId } : { ...payload },
      ),
    };
    if (options.content) update.content = options.content;
    if (options.reasoning) update.reasoning = { content: options.reasoning };
    return update;
  }

  /** Final safety flush triggered by `heteroFinish`. */
  private async flushFinalState(
    state: OperationState,
    error: { message: string; type: string } | undefined,
    result: 'success' | 'error' | 'cancelled',
  ) {
    if (!state.main.accContent && !state.main.accReasoning && !error && result !== 'error') {
      // Nothing pending — terminal event already flushed in-stream.
      return;
    }

    const updateValue: Record<string, any> = {};
    if (state.main.accContent) updateValue.content = state.main.accContent;
    if (state.main.accReasoning) updateValue.reasoning = { content: state.main.accReasoning };
    if (error) {
      // `error.type` is a free-form string from the CLI; coerce to the
      // shared union via `as` since the runtime contract accepts arbitrary
      // values (renderer-side error classifier already does the same).
      const errType = (error.type ||
        AgentRuntimeErrorType.AgentRuntimeError) as ChatMessageError['type'];
      updateValue.error = {
        body: { message: error.message },
        message: error.message,
        type: errType,
      } satisfies ChatMessageError;
    }

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
    if (Object.keys(state.main.turnMetadata).length > 0) update.metadata = state.main.turnMetadata;
    await this.deps.messageModel.update(state.main.currentAssistantId, update);
  }

  private toChatMessageError(data: unknown): ChatMessageError {
    if (typeof data === 'object' && data && 'message' in data) {
      const message =
        typeof (data as any).message === 'string' ? (data as any).message : 'Agent runtime error';
      return {
        body: data as Record<string, unknown>,
        message,
        type: AgentRuntimeErrorType.AgentRuntimeError,
      };
    }
    const message = typeof data === 'string' ? data : 'Agent runtime error';
    return {
      body: { message },
      message,
      type: AgentRuntimeErrorType.AgentRuntimeError,
    };
  }

  private async applySubagentIntent(state: OperationState, intent: SubagentIntent) {
    switch (intent.kind) {
      case 'createThread': {
        await this.deps.threadModel.create({
          id: intent.threadId,
          metadata: {
            // Stamp the owning hetero operation so `refreshSubagentRunsFromDb`
            // only rehydrates threads from THIS run — never a stale Processing
            // thread a prior crashed/cancelled run left on the same topic.
            operationId: state.operationId,
            sourceToolCallId: intent.sourceToolCallId,
            startedAt: new Date().toISOString(),
            subagentType: intent.subagentType,
          },
          sourceMessageId: intent.sourceMessageId,
          status: ThreadStatus.Processing,
          title: intent.title,
          topicId: intent.topicId ?? state.topicId,
          type: ThreadType.Isolation,
        } as any);
        return;
      }

      case 'createMessage': {
        await this.deps.messageModel.create(
          {
            agentId: intent.agentId ?? undefined,
            content: intent.content,
            // Persist the turn's CC message.id so a cold replica can recover
            // `currentSubagentMessageId` (via buildSubagentSnapshot) and avoid
            // a spurious turn boundary that fragments one CC turn into multiple
            // in-thread assistant rows + empty shells.
            ...(intent.subagentMessageId
              ? { metadata: { subagentMessageId: intent.subagentMessageId } }
              : {}),
            parentId: intent.parentId,
            role: intent.role,
            threadId: intent.threadId,
            topicId: intent.topicId ?? state.topicId,
          } as any,
          intent.messageId,
        );
        return;
      }

      // Live in-memory UI updates have no server surface; durable writes land
      // via persistContent / persistToolBatch.
      case 'streamContent': {
        return;
      }

      case 'resolveToolResult': {
        await this.applyToolResult(state, intent);
        return;
      }

      case 'persistContent': {
        const update: Record<string, any> = {};
        if (intent.content) update.content = intent.content;
        if (intent.reasoning) update.reasoning = { content: intent.reasoning };
        if (Object.keys(update).length > 0) {
          await this.deps.messageModel.update(intent.messageId, update);
        }
        return;
      }

      case 'persistToolBatch': {
        const buildUpdate = (withResult: boolean) =>
          this.buildToolBatchUpdate(intent.tools, {
            content: intent.content,
            reasoning: intent.reasoning,
            withResult,
          });

        // Phase 1: pre-register assistant.tools[] (no result_msg_id yet).
        await this.deps.messageModel.update(intent.assistantMessageId, buildUpdate(false));

        // Phase 2: create rows for new tools with their pre-allocated ids and
        // register them in the global tool-message map for tool_result lookup.
        for (const t of intent.tools) {
          if (!t.isNew) continue;
          await this.deps.messageModel.create(
            {
              agentId: state.agentId ?? undefined,
              content: '',
              parentId: intent.assistantMessageId,
              plugin: {
                apiName: t.payload.apiName,
                arguments: t.payload.arguments,
                identifier: t.payload.identifier,
                type: t.payload.type,
              },
              role: 'tool',
              threadId: intent.threadId,
              tool_call_id: t.payload.id,
              topicId: state.topicId,
            } as any,
            t.toolMessageId,
          );
          state.toolMsgIdByCallId.set(t.payload.id, t.toolMessageId);
        }

        // Phase 3: backfill result_msg_id on assistant.tools[].
        await this.deps.messageModel.update(intent.assistantMessageId, buildUpdate(true));
        return;
      }

      case 'recordUsage': {
        await this.deps.messageModel.update(intent.messageId, {
          metadata: { usage: intent.usage as any },
          ...(intent.model && { model: intent.model }),
          ...(intent.provider && { provider: intent.provider }),
        });
        return;
      }

      case 'finalizeThread': {
        await this.deps.threadModel.update(intent.threadId, { status: ThreadStatus.Active });
        return;
      }
    }
  }
}
