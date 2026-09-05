import {
  type AgentInterventionInteractionKind,
  type AgentInterventionProvider,
  type AgentInterventionRequestData,
  type AgentStreamEvent,
  sanitizeAgentInterventionRequestForReview,
} from '@lobechat/agent-gateway-client';
import { LOADING_FLAT } from '@lobechat/const';
import type {
  MainAgentIntent,
  MainAgentInterventionTransition,
  MainAgentReduceCtx,
  MainAgentRunState,
  MainAgentTurnToolState,
  SubagentIntent,
  SubagentRunSnapshot,
  ToolCallPayload,
} from '@lobechat/heterogeneous-agents';
import {
  createMainAgentRunState,
  isHeteroStatusGuideErrorData,
  reduceMainAgent,
  rehydrateSubagentRunsState,
} from '@lobechat/heterogeneous-agents';
import { type ChatToolPayload, ThreadStatus, ThreadType } from '@lobechat/types';
import { createNanoId } from '@lobechat/utils';
import debug from 'debug';

import {
  deriveAgentInterventionActivityKey,
  hashAgentInterventionRequestRevision,
} from '@/business/server/agent-run/agentInterventionIdentity';
import {
  acknowledgeAgentInterventionProducerResolution,
  type AgentInterventionAllowedAction,
  type AgentInterventionReviewDetail,
  notifyAgentInterventionRequired,
  type NotifyAgentInterventionRequiredParams,
} from '@/business/server/agent-run/agentInterventionReview';
import type { MessageModel } from '@/database/models/message';
import type { ThreadModel } from '@/database/models/thread';
import type { TopicModel } from '@/database/models/topic';
import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';

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
  reasoningSnapshotSeq: number;
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
  /**
   * CC-native session id this run is producing, captured off the stream_start
   * event stream and stamped on every persisted message's
   * `metadata.heteroSessionId`. Run-global and stable; a change ACROSS a topic
   * (visible only because it's copied per-message) means CC forked a new
   * session — the forensic signal for a lost-`--resume` "session break".
   * Recovered on a cold replica from the current assistant's stamped metadata.
   */
  heteroSessionId: string | undefined;
  /** Last DB-confirmed tool-state seq, scoped to this operation. */
  lastAppliedToolStateSeqByCallId: Map<string, number>;
  lastStepIndex: number;
  main: MainAgentRunState;
  /** `(operationId, toolCallId, transition)` notification dedupe ledger. */
  notifiedInterventionTransitions: Set<string>;
  operationId: string;
  processedKeys: Set<string>;
  /**
   * Publish gate, peer of `processedKeys` but for the live-stream sink.
   * Persistence and publish fail independently: a batch can persist fully
   * yet die inside the publish loop — its retry must republish ONLY the
   * unpublished tail — while a batch whose tRPC response was lost after
   * full success must republish nothing. Keyed by `eventKey`, latched only
   * after the event's XADD succeeds.
   */
  publishedKeys: Set<string>;
  /** Isolation thread that owns this heterogeneous run, when applicable. */
  threadId: string | undefined;
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
  userId?: string;
  workspaceId?: string;
}

interface StoredHeterogeneousIntervention {
  deadline?: number;
  interactionKind?: AgentInterventionInteractionKind;
  notificationTransition?: MainAgentInterventionTransition;
  provider?: AgentInterventionProvider;
  resolutionRequestId?: string;
  summary?: string;
  transition?: MainAgentInterventionTransition;
}

const HETEROGENEOUS_INTERVENTION_STATE_KEY = 'heterogeneousIntervention';

const interventionSummary = (request?: AgentInterventionRequestData): string => {
  const provider = request?.provider ?? 'heterogeneous-agent';
  const kind = request?.interactionKind ?? 'question';
  const apiName = request?.apiName || 'interaction';
  return `${provider} ${kind}: ${apiName}`.slice(0, 160);
};

const buildHeterogeneousReviewDetail = (
  request: AgentInterventionRequestData,
): Extract<AgentInterventionReviewDetail, { type: 'permission' | 'plan' | 'question' }> => {
  const parsed = JSON.parse(request.arguments) as {
    questions: Array<{
      header: string;
      multiSelect: boolean;
      options: Array<{ description?: string; id?: string; label: string }>;
      question: string;
    }>;
  };
  const questions = parsed.questions.map((question, questionIndex) => ({
    header: question.header || undefined,
    id: `question_${questionIndex + 1}`,
    multiple: question.multiSelect,
    options: question.options.map((option) => ({
      description: option.description,
      id: option.id ?? option.label,
      label: option.label,
    })),
    question: question.question,
  }));
  const first = questions[0];

  switch (request.interactionKind) {
    case 'permission': {
      return {
        description: first.header,
        options: first.options,
        title: first.question,
        type: 'permission',
      };
    }
    case 'plan': {
      return {
        content: first.question,
        options: first.options,
        title: first.header ?? 'Review plan',
        type: 'plan',
      };
    }
    case 'question': {
      return { questions, title: first.header, type: 'question' };
    }
    default: {
      throw new Error('Unsupported heterogeneous intervention kind');
    }
  }
};

const heterogeneousActionsFor = (
  interactionKind: AgentInterventionInteractionKind,
): AgentInterventionAllowedAction[] =>
  interactionKind === 'question'
    ? ['submit_answers', 'skip_interaction']
    : ['select_provider_option', 'skip_interaction'];

const INTERVENTION_TRANSITIONS = new Set<MainAgentInterventionTransition>([
  'cancelled',
  'pending',
  'resolved',
  'session_ended',
  'timed_out',
]);

const INTERVENTION_KINDS = new Set<AgentInterventionInteractionKind>([
  'permission',
  'plan',
  'question',
]);

const INTERVENTION_PROVIDERS = new Set<AgentInterventionProvider>([
  'claude-code',
  'cursor',
  'droid',
  'qoder',
]);

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

  /** Latch an event as published so a batch retry skips its XADD. */
  markEventPublished(operationId: string, event: AgentStreamEvent): void {
    operationStates.get(operationId)?.publishedKeys.add(eventKey(event));
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
   * - A promise that resolves after final message state is flushed and released.
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
    if (!state && params.result === 'error' && params.error && params.topicId) {
      try {
        state = await this.loadOrCreateState(
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
      await this.flushFinalState(state, params.error, params.result);
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

  // ─── State management ────────────────────────────────────────────────────

  private async loadOrCreateState(
    operationId: string,
    topicId: string,
    seedAssistantMessageId?: string,
    allowMissingRunningOperation = false,
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
    const marker = topic?.metadata?.runningOperation;
    const running =
      marker?.operationId === operationId
        ? marker
        : marker?.childOperations?.find((child) => child.operationId === operationId);

    if (!running && !(allowMissingRunningOperation && seedAssistantMessageId)) {
      throw new StaleHeteroOperationError(
        `Stale hetero operation ${operationId} on topic ${topicId}; no active runningOperation`,
      );
    }

    if (!running && !(allowMissingRunningOperation && seedAssistantMessageId)) {
      throw new StaleHeteroOperationError(
        `Stale hetero operation ${operationId} on topic ${topicId}; current operation is ${marker?.operationId ?? 'unknown'}`,
      );
    }

    // Prefer the assistantMessageId forwarded in the ingest payload (sandbox path).
    // The orchestrator already has it in-memory and passes it through env → CLI → tRPC,
    // so this path avoids depending on `runningOperation.assistantMessageId`
    // itself being readable on this replica. We still require the topic's
    // runningOperation binding to match `operationId`, otherwise late/retried
    // batches after finish could keep mutating a completed turn.
    // Fall back to topic.metadata for desktop / old-CLI callers that lack the field.
    const baseAssistantMessageId = seedAssistantMessageId ?? running?.assistantMessageId;

    if (!baseAssistantMessageId) {
      throw new Error(`runningOperation on topic ${topicId} is missing assistantMessageId`);
    }

    const baseAssistantMessage = await this.deps.messageModel.findById(baseAssistantMessageId);

    if (seedAssistantMessageId) {
      if (!baseAssistantMessage) {
        throw new Error(
          `Seeded assistantMessageId ${seedAssistantMessageId} was not found for topic ${topicId}`,
        );
      }
      if (baseAssistantMessage.topicId !== topicId) {
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
      // A direct @Agent run keeps the topic under the conversation owner while
      // the seeded assistant belongs to the executing target Agent. Every
      // follow-up step and tool row must inherit the assistant author, not the
      // topic owner, or the post-tool answer appears to switch back to Lobe AI.
      // Legacy/finish-only callers may not have a readable assistant row; keep
      // the historical topic-owner fallback for those paths.
      agentId: baseAssistantMessage?.agentId ?? topic?.agentId ?? null,
      // Left undefined until the run's own stream_start reports it (or a cold
      // replica recovers it from a stamped message). NOT seeded from
      // topic.metadata.heteroSessionId: that holds the id we ASKED CC to resume,
      // which differs from the actual id when a fork/new session occurred.
      heteroSessionId: undefined,
      lastStepIndex: 0,
      lastAppliedToolStateSeqByCallId: new Map(),
      main: createMainAgentRunState(currentAssistantMessageId),
      operationId,
      notifiedInterventionTransitions: new Set(),
      processedKeys: new Set(),
      publishedKeys: new Set(),
      toolMsgIdByCallId: new Map(),
      threadId: running?.threadId ?? undefined,
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
    const reasoningSnapshotSeq = Number(metadata.heteroReasoningSnapshotSeq ?? 0);
    return {
      content: rawContent === LOADING_FLAT ? '' : rawContent,
      metadata,
      model: message?.model,
      parentId: message?.parentId,
      provider: message?.provider,
      reasoning: (message?.reasoning as { content?: string } | null)?.content ?? '',
      reasoningSnapshotSeq: Number.isFinite(reasoningSnapshotSeq) ? reasoningSnapshotSeq : 0,
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

  private async refreshToolMessageIndex(state: OperationState): Promise<void> {
    const toolPlugins = await this.deps.messageModel.listMessagePluginsByTopic(state.topicId);
    for (const plugin of toolPlugins) {
      if (plugin.toolCallId) state.toolMsgIdByCallId.set(plugin.toolCallId, plugin.id);
      if (plugin.toolCallId && plugin.state && typeof plugin.state === 'object') {
        const stored = (plugin.state as Record<string, unknown>)[
          HETEROGENEOUS_INTERVENTION_STATE_KEY
        ];
        if (stored && typeof stored === 'object') {
          const metadata = stored as Record<string, unknown>;
          const transition = INTERVENTION_TRANSITIONS.has(
            metadata.transition as MainAgentInterventionTransition,
          )
            ? (metadata.transition as MainAgentInterventionTransition)
            : undefined;
          const interactionKind = INTERVENTION_KINDS.has(
            metadata.interactionKind as AgentInterventionInteractionKind,
          )
            ? (metadata.interactionKind as AgentInterventionInteractionKind)
            : undefined;
          const provider = INTERVENTION_PROVIDERS.has(
            metadata.provider as AgentInterventionProvider,
          )
            ? (metadata.provider as AgentInterventionProvider)
            : undefined;

          if (transition) {
            const request =
              typeof plugin.apiName === 'string' &&
              typeof plugin.arguments === 'string' &&
              typeof plugin.identifier === 'string' &&
              typeof metadata.deadline === 'number'
                ? {
                    apiName: plugin.apiName,
                    arguments: plugin.arguments,
                    deadline: metadata.deadline,
                    identifier: plugin.identifier,
                    interactionKind,
                    provider,
                    toolCallId: plugin.toolCallId,
                  }
                : undefined;
            state.main.interventionsByCallId.set(plugin.toolCallId, {
              intervention:
                plugin.intervention ??
                (transition === 'pending'
                  ? { status: 'pending' }
                  : transition === 'resolved'
                    ? { status: 'approved' }
                    : { rejectedReason: transition, status: 'rejected' }),
              request,
              resolutionRequestId:
                typeof metadata.resolutionRequestId === 'string'
                  ? metadata.resolutionRequestId
                  : undefined,
              transition,
            });

            if (metadata.notificationTransition === transition) {
              state.notifiedInterventionTransitions.add(
                `${state.operationId}:${plugin.toolCallId}:${transition}`,
              );
            }
          }
        }
      }
      if (
        plugin.toolCallId &&
        plugin.metadata?.heterogeneousToolStateOperationId === state.operationId &&
        typeof plugin.metadata.heterogeneousToolStateSeq === 'number'
      ) {
        state.lastAppliedToolStateSeqByCallId.set(
          plugin.toolCallId,
          Math.max(
            state.lastAppliedToolStateSeqByCallId.get(plugin.toolCallId) ?? 0,
            plugin.metadata.heterogeneousToolStateSeq,
          ),
        );
      }
    }
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

    // Recover the in-flight turn's CC message.id so a replayed `newStep` (cold
    // replica retry) is recognized as the SAME turn — no duplicate assistant,
    // no usage-only empty shell. Mirrors the subagent path's recovery of
    // `currentSubagentMessageId` from `metadata.subagentMessageId`.
    if (typeof snapshot.metadata.mainMessageId === 'string') {
      state.main.currentMainMessageId = snapshot.metadata.mainMessageId;
    }

    // Recover the run's CC session id from a previously-stamped message so a
    // cold replica that never saw this run's stream_start still stamps the
    // right session id on the messages it persists.
    if (!state.heteroSessionId && typeof snapshot.metadata.heteroSessionId === 'string') {
      state.heteroSessionId = snapshot.metadata.heteroSessionId;
    }

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

    // Seq-guarded reasoning restore mirrors the text path above; the length
    // heuristic stays as the fallback for legacy rows without a stamped seq.
    if (snapshot.reasoningSnapshotSeq > state.main.lastReasoningSnapshotSeq) {
      state.main.accReasoning = snapshot.reasoning;
      state.main.lastReasoningSnapshotSeq = snapshot.reasoningSnapshotSeq;
    } else if (snapshot.reasoning.length > state.main.accReasoning.length) {
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

    // Recover the chain spine from the DB. The next normal
    // turn parents off the run's latest main-thread message that is neither a
    // tool nor a TOOLLESS signal callback (a tools-bearing signal turn is
    // main-chain — see `getLatestSpineMessageId`); reading it straight
    // from the DB (independent of
    // `currentAssistantId`, which can regress to the seed placeholder on a cold
    // / non-sticky replica — see the multi-replica caveat on the class) keeps
    // consecutive cold-replica steps chained linearly instead of forking onto a
    // stale node. Signal turns still anchor off `lastToolMsgIdEver`, which is
    // maintained in-memory across the run's tool batches.
    const spineId = await this.deps.messageModel.getLatestSpineMessageId({
      threadId: state.threadId ?? null,
      topicId: state.topicId,
    });
    if (spineId) state.main.lastSpineMessageId = spineId;
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
   * `toolState`) are never clobbered by the DB projection.
   *
   * Finalized (`Active`) spawns are NOT rehydrated as live runs (a completed
   * spawn is never resurrected — that would mint spurious empty assistants and
   * re-finalize churn), but their `sourceToolCallId` IS recorded in
   * `finalizedParents` so a REPLAYED first-event on a cold replica can't fork a
   * duplicate thread for a spawn that already finished (the "一模一样的两个
   * thread" bug). This mirrors #15838's main-turn idempotency for the subagent
   * thread-create step: dedup keyed by the DB-homed `sourceToolCallId`,
   * independent of in-memory state and of thread status.
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
      // Union with any parents finalized in-memory on a warm replica.
      const finalizedParents = new Set(state.main.subagents.finalizedParents);

      for (const thread of threads ?? []) {
        if (thread.type !== ThreadType.Isolation) continue;
        const meta = thread.metadata as { operationId?: string; sourceToolCallId?: string } | null;
        // Operation-scoped: only attend to threads THIS operation created.
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

        // Finalized spawn → remember the key (blocks duplicate create), don't
        // rehydrate it as a live run.
        if (thread.status !== ThreadStatus.Processing) {
          finalizedParents.add(parentToolCallId);
          continue;
        }

        const messages = await this.deps.messageModel.query({
          threadId: thread.id,
          topicId: state.topicId,
        });
        const snapshot = this.buildSubagentSnapshot(parentToolCallId, thread.id, messages);
        if (snapshot) snapshots.push(snapshot);
      }

      // Nothing new to project: no rehydratable runs AND no finalized keys
      // beyond what memory already tracked (the set started as a copy of it and
      // only grows, so an unchanged size means no new Active threads were found).
      if (
        snapshots.length === 0 &&
        finalizedParents.size === state.main.subagents.finalizedParents.size
      ) {
        return;
      }

      // Union: rehydrated (missing) runs + the in-memory ones (which win, since
      // they carry live accumulators the DB hasn't caught up to yet) + the
      // finalized-parent guard set.
      const merged = rehydrateSubagentRunsState(snapshots, [...finalizedParents]);
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
    // Chain rule: the next turn's assistant parents off the
    // prior assistant (the spine), not its last child tool — recover the anchor
    // as the current assistant itself (matches the subagent reducer, and is
    // fork-resistant since it reads the thread's real latest assistant from DB).
    const lastChainParentId = currentAssistant.id;
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
    const marker = topic?.metadata?.runningOperation;
    const running =
      marker?.operationId === state.operationId
        ? marker
        : marker?.childOperations?.find((child) => child.operationId === state.operationId);

    if (!running) {
      throw new StaleHeteroOperationError(
        `Stale hetero operation ${state.operationId} on topic ${state.topicId}; current operation is ${marker?.operationId ?? 'unknown'}`,
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
      lastReasoningSnapshotSeq: 0,
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

    const { intents, state: next } = reduceMainAgent(state.main, event, this.mainReduceCtx(state));

    for (const intent of intents) {
      if ('threadId' in intent) {
        await this.applySubagentIntent(state, intent as SubagentIntent);
      } else {
        await this.applyMainIntent(state, intent as MainAgentIntent, event.stepIndex);
      }
    }

    state.main = next;
  }

  /**
   * Per-message provenance stamped on every hetero-persisted row: the CC
   * session id the turn ran under (`heteroSessionId`) and, when known, the CC
   * `message.id` of the turn (`heteroMessageId`). A per-message copy lets a
   * diff pinpoint the exact row where CC forked to a new session / lost
   * `--resume` history — something the topic-level single `heteroSessionId`
   * can never show. Returns `{}` when neither is known, so callers can spread
   * it without minting empty metadata.
   */
  private heteroProvenance(
    state: OperationState,
    heteroMessageId?: string,
  ): { heteroMessageId?: string; heteroSessionId?: string } {
    const out: { heteroMessageId?: string; heteroSessionId?: string } = {};
    if (state.heteroSessionId) out.heteroSessionId = state.heteroSessionId;
    if (heteroMessageId) out.heteroMessageId = heteroMessageId;
    return out;
  }

  private async applyMainIntent(state: OperationState, intent: MainAgentIntent, stepIndex: number) {
    switch (intent.kind) {
      case 'createAssistant': {
        const createMetadata: Record<string, any> = {
          ...this.heteroProvenance(state, intent.mainMessageId),
        };
        if (intent.signal) createMetadata.signal = intent.signal;
        // Persist the turn's CC message.id so a cold replica can recover
        // `currentMainMessageId` (via refreshMainStateFromDb) and dedupe a
        // replayed `newStep` instead of forking a duplicate + empty shell.
        if (intent.mainMessageId) createMetadata.mainMessageId = intent.mainMessageId;
        await this.deps.messageModel.create(
          {
            agentId: intent.agentId ?? undefined,
            content: '',
            ...(Object.keys(createMetadata).length > 0 ? { metadata: createMetadata } : {}),
            model: intent.model,
            parentId: intent.parentId,
            provider: intent.provider,
            role: 'assistant',
            threadId: state.threadId,
            topicId: intent.topicId ?? state.topicId,
          } as any,
          intent.messageId,
        );

        if (this.deps.topicModel.updateRunningOperationAssistantMessage) {
          await this.deps.topicModel.updateRunningOperationAssistantMessage(
            state.topicId,
            state.operationId,
            intent.messageId,
          );
        } else {
          await this.deps.topicModel.updateMetadata(state.topicId, {
            heteroCurrentMsgId: { msgId: intent.messageId, operationId: state.operationId },
          });
        }
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
          const toolMetadata = this.heteroProvenance(state, state.main.currentMainMessageId);
          await this.deps.messageModel.create(
            {
              agentId: state.agentId ?? undefined,
              content: '',
              ...(Object.keys(toolMetadata).length > 0 ? { metadata: toolMetadata } : {}),
              parentId: intent.assistantMessageId,
              plugin: {
                apiName: tool.payload.apiName,
                arguments: tool.payload.arguments,
                identifier: tool.payload.identifier,
                type: tool.payload.type,
              },
              role: 'tool',
              threadId: state.threadId,
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

      case 'updateToolState': {
        await this.applyToolState(state, intent);
        return;
      }

      case 'setToolIntervention': {
        await this.applyToolIntervention(state, intent, stepIndex);
        return;
      }

      case 'recordUsage': {
        const update: Record<string, any> = {};
        if (intent.usage !== undefined) {
          // This overwrites the row's metadata wholesale, so re-stamp the
          // provenance the createAssistant write put there, or usage would wipe it.
          update.metadata = {
            ...state.main.turnMetadata,
            ...this.heteroProvenance(state, state.main.currentMainMessageId),
            usage: intent.usage,
          };
        }
        if (intent.model) update.model = intent.model;
        if (intent.provider) update.provider = intent.provider;
        if (Object.keys(update).length > 0) {
          await this.deps.messageModel.update(intent.messageId, update);
        }
        return;
      }

      case 'setError': {
        // Normalize the CLI agent's wire error data through the SAME canonical
        // formatter the in-process runtime uses, so a hetero error is classified
        // (attribution/category/retryable) identically and the renderer never sees
        // a second, hetero-only error shape.
        const update: Record<string, any> = { error: formatErrorForState(intent.errorData) };
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

    const result = await this.deps.messageModel.updateToolMessage(toolMsgId, {
      content: intent.content,
      pluginError: intent.isError ? { message: intent.content } : undefined,
      pluginState: intent.pluginState,
    });
    if (!result.success) {
      throw new Error(`Failed to persist tool_result for message ${toolMsgId}`);
    }
  }

  private async applyToolState(
    state: OperationState,
    intent: {
      pluginState: Record<string, unknown>;
      snapshotSeq: number;
      toolCallId: string;
    },
  ): Promise<void> {
    const lastApplied = state.lastAppliedToolStateSeqByCallId.get(intent.toolCallId) ?? 0;
    if (intent.snapshotSeq <= lastApplied) return;

    const toolMsgId = state.toolMsgIdByCallId.get(intent.toolCallId);
    if (!toolMsgId) {
      throw new Error(
        `tool_state for unknown toolCallId=${intent.toolCallId} op=${state.operationId}`,
      );
    }

    const result = await this.deps.messageModel.updateToolMessage(toolMsgId, {
      heterogeneousToolState: {
        operationId: state.operationId,
        snapshotSeq: intent.snapshotSeq,
      },
      pluginState: intent.pluginState,
    });
    if (!result.success) {
      throw new Error(`Failed to persist tool_state for message ${toolMsgId}`);
    }

    state.lastAppliedToolStateSeqByCallId.set(
      intent.toolCallId,
      result.snapshotSeq ?? intent.snapshotSeq,
    );
  }

  private async applyToolIntervention(
    state: OperationState,
    intent: Extract<MainAgentIntent, { kind: 'setToolIntervention' }>,
    stepIndex: number,
  ): Promise<void> {
    const toolMsgId = state.toolMsgIdByCallId.get(intent.toolCallId);
    if (!toolMsgId) {
      throw new Error(
        `intervention for unknown toolCallId=${intent.toolCallId} op=${state.operationId}`,
      );
    }

    const summary = interventionSummary(intent.request);
    const reviewRequest = sanitizeAgentInterventionRequestForReview(intent.request);
    const transitionKey = `${state.operationId}:${intent.toolCallId}:${intent.transition}`;
    const pendingTransitionKey = `${state.operationId}:${intent.toolCallId}:pending`;
    const requiresPendingReviewNotification =
      !!this.deps.userId &&
      !state.notifiedInterventionTransitions.has(transitionKey) &&
      !state.notifiedInterventionTransitions.has(pendingTransitionKey);
    if (
      requiresPendingReviewNotification &&
      (!reviewRequest?.interactionKind || !reviewRequest.provider)
    ) {
      throw new Error(
        `Unsafe heterogeneous intervention review payload toolCallId=${intent.toolCallId}`,
      );
    }
    const durableState: StoredHeterogeneousIntervention = {
      deadline: intent.request?.deadline,
      interactionKind: intent.request?.interactionKind,
      provider: intent.request?.provider,
      resolutionRequestId: intent.resolutionRequestId,
      summary,
      transition: intent.transition,
    };

    // Persist before any business side effect. The existing JSON plugin-state
    // column carries only correlation metadata; no schema/migration is needed.
    await this.deps.messageModel.updateMessagePlugin(toolMsgId, {
      intervention: intent.intervention,
    });
    await this.deps.messageModel.updatePluginState(toolMsgId, {
      [HETEROGENEOUS_INTERVENTION_STATE_KEY]: durableState,
    });

    if (!this.deps.userId || state.notifiedInterventionTransitions.has(transitionKey)) return;

    if (!state.notifiedInterventionTransitions.has(pendingTransitionKey)) {
      if (!reviewRequest?.interactionKind || !reviewRequest.provider) {
        throw new Error(
          `Unsafe heterogeneous intervention review payload toolCallId=${intent.toolCallId}`,
        );
      }
      const assistantMessageId = state.main.currentAssistantId;
      if (!assistantMessageId) {
        throw new Error(
          `Missing assistant owner for heterogeneous intervention toolCallId=${intent.toolCallId}`,
        );
      }
      // Heterogeneous callbacks are individually sealed. Include the tool call
      // so two concurrent interventions emitted by one assistant step never
      // claim the same batch identity with conflicting item-0 contents.
      const batchId = `${state.operationId}:${stepIndex}:${assistantMessageId}:${intent.toolCallId}`;
      // The generic Web source bridge reads the same authoritative correlation
      // from the tool row. Stamp it before notify so a card can never appear
      // actionable while its operation/batch locator is still absent.
      await this.deps.messageModel.updateMessagePlugin(toolMsgId, {
        intervention: {
          ...intent.intervention,
          batchId,
          itemIndex: 0,
          operationId: state.operationId,
          stepIndex,
        },
      });
      const allowedActions = heterogeneousActionsFor(reviewRequest.interactionKind);
      const notification: NotifyAgentInterventionRequiredParams = {
        agentId: state.agentId ?? undefined,
        approvalMode: 'manual',
        batch: {
          activityKey: deriveAgentInterventionActivityKey({
            batchId,
            operationId: state.operationId,
            userId: this.deps.userId,
            workspaceId: this.deps.workspaceId,
          }),
          allowedActions: [],
          id: batchId,
          kind: 'single',
          sealed: true,
          stepIndex,
        },
        context: {
          agentId: state.agentId ?? undefined,
          assistantMessageId,
          operationId: state.operationId,
          topicId: state.topicId,
          workspaceId: this.deps.workspaceId,
        },
        deadline: reviewRequest.deadline,
        items: [
          {
            allowedActions,
            detail: buildHeterogeneousReviewDetail(reviewRequest),
            interactionKind: reviewRequest.interactionKind,
            provider: reviewRequest.provider,
            requestRevision: {
              hash: hashAgentInterventionRequestRevision(intent.request?.arguments ?? ''),
              version: 1,
            },
            sourceRef: {
              operationId: state.operationId,
              toolCallId: intent.toolCallId,
              type: 'heterogeneous',
            },
            summary,
            surface: 'form',
          },
        ],
        summary,
        systemActionEligibility: 'review_only',
        userId: this.deps.userId,
        workspaceId: this.deps.workspaceId,
      };
      await notifyAgentInterventionRequired(notification);
      state.notifiedInterventionTransitions.add(pendingTransitionKey);
    }

    if (intent.transition !== 'pending') {
      await acknowledgeAgentInterventionProducerResolution({
        operationId: state.operationId,
        ownerUserId: this.deps.userId,
        resolutionRequestId: intent.resolutionRequestId,
        status: intent.transition,
        toolCallId: intent.toolCallId,
        workspaceId: this.deps.workspaceId,
      });
    }
    state.notifiedInterventionTransitions.add(transitionKey);

    // Cold-replica dedupe marker. Cloud's override must still use the same
    // `(operationId, toolCallId, transition)` idempotency key because a process
    // can die after the external side effect but before this best-effort stamp.
    await this.deps.messageModel.updatePluginState(toolMsgId, {
      [HETEROGENEOUS_INTERVENTION_STATE_KEY]: {
        ...durableState,
        notificationTransition: intent.transition,
      },
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
    error: { body?: Record<string, unknown>; message: string; type: string } | undefined,
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
      if (error.body?.clearEchoedContent === true) updateValue.content = '';
      // Same canonical normalization as the in-stream `setError` path — the CLI's
      // free-form `{ message, type }` runs through formatErrorForState so the
      // terminal flush and the in-stream write produce one classified error shape.
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
        isHeteroStatusGuideErrorData(
          (await this.deps.messageModel.findById(state.main.currentAssistantId))?.error?.body,
        );
      if (!overwritesGuideError) updateValue.error = formatErrorForState(error);
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
        const subMetadata: Record<string, any> = {
          ...this.heteroProvenance(state, intent.subagentMessageId),
        };
        // Persist the turn's CC message.id so a cold replica can recover
        // `currentSubagentMessageId` (via buildSubagentSnapshot) and avoid
        // a spurious turn boundary that fragments one CC turn into multiple
        // in-thread assistant rows + empty shells.
        if (intent.subagentMessageId) subMetadata.subagentMessageId = intent.subagentMessageId;
        await this.deps.messageModel.create(
          {
            agentId: intent.agentId ?? undefined,
            content: intent.content,
            ...(Object.keys(subMetadata).length > 0 ? { metadata: subMetadata } : {}),
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

      case 'updateToolState': {
        await this.applyToolState(state, intent);
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
          const subToolMetadata = this.heteroProvenance(state, intent.subagentMessageId);
          await this.deps.messageModel.create(
            {
              agentId: state.agentId ?? undefined,
              content: '',
              ...(Object.keys(subToolMetadata).length > 0 ? { metadata: subToolMetadata } : {}),
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
          // Wholesale metadata overwrite — re-stamp the session + message
          // provenance the createMessage write put there, or usage would wipe it.
          metadata: {
            ...this.heteroProvenance(state, intent.subagentMessageId),
            usage: intent.usage as any,
          },
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
