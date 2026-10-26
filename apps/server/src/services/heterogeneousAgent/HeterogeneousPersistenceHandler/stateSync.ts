import {
  type AgentInterventionInteractionKind,
  type AgentInterventionProvider,
} from '@lobechat/agent-gateway-client';
import { LOADING_FLAT } from '@lobechat/const';
import type {
  MainAgentInterventionTransition,
  MainAgentTurnToolState,
  SubagentRunSnapshot,
  ToolCallPayload,
} from '@lobechat/heterogeneous-agents';
import {
  createMainAgentRunState,
  rehydrateSubagentRunsState,
} from '@lobechat/heterogeneous-agents';
import { type ChatToolPayload, ThreadStatus, ThreadType } from '@lobechat/types';
import debug from 'debug';

import { restoreHeteroProvenance } from '../heteroProvenance';
import {
  HETEROGENEOUS_INTERVENTION_STATE_KEY,
  INTERVENTION_KINDS,
  INTERVENTION_PROVIDERS,
  INTERVENTION_TRANSITIONS,
} from './intervention';
import { operationStates, StaleHeteroOperationError } from './operationState';
import type { HeterogeneousPersistenceHandlerDeps, OperationState } from './types';

const log = debug('lobe-server:hetero-agent:persistence');

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

export async function loadOrCreateState(
  deps: HeterogeneousPersistenceHandlerDeps,
  operationId: string,
  topicId: string,
  seedAssistantMessageId?: string,
  allowMissingRunningOperation = false,
): Promise<OperationState> {
  let state = operationStates.get(operationId);
  // A cached state must never be reused for another topic.
  if (state && state.topicId !== topicId) {
    throw new Error(
      `Operation ${operationId} is already bound to topic ${state.topicId}, not ${topicId}`,
    );
  }

  const topic = await deps.topicModel.findById(topicId);
  const marker = topic?.metadata?.runningOperation;
  const running =
    marker?.operationId === operationId
      ? marker
      : marker?.childOperations?.find((child) => child.operationId === operationId);

  if (!running) {
    // Two different fates were collapsed into one refusal here.
    //
    // A marker naming ANOTHER operation means a newer run owns the topic:
    // this batch is genuinely late and has to be dropped, or it would keep
    // mutating a turn the conversation has already moved past.
    //
    // NO marker at all is a different story. The marker is a best-effort
    // rendering pointer that a client can settle on nothing more than a
    // transport signal — a raw `session_complete`, or one multiplexed socket
    // failing auth for every operation on the tab — while the producer is
    // still running and streaming. Refusing there throws away the whole
    // remaining output of a live CLI, which then burns minutes of work
    // nobody stores. The operation row is the authority on liveness, so ask
    // it: still `running`, still bound to THIS topic ⇒ keep persisting
    // without a marker. The turn's own pointers (`heteroCurrentMsgId`, the
    // seeded assistant message) carry the rest.
    const producerStillOwnsTopic =
      !marker && (await deps.isOperationLiveOnTopic?.(operationId, topicId));

    if (producerStillOwnsTopic) {
      log('marker missing but operation still running op=%s topic=%s', operationId, topicId);
    } else if (!(allowMissingRunningOperation && seedAssistantMessageId)) {
      throw new StaleHeteroOperationError(
        marker
          ? `Stale hetero operation ${operationId} on topic ${topicId}; current operation is ${marker.operationId}`
          : `Stale hetero operation ${operationId} on topic ${topicId}; no active runningOperation`,
      );
    }
  }

  // Cached accumulators do not grant write ownership. A steer can replace the
  // topic's operation without advancing this producer's step index, so every
  // batch must pass the same ownership/liveness check as a cold replica.
  if (state) return state;

  // Prefer the assistantMessageId forwarded in the ingest payload (sandbox path).
  // The orchestrator already has it in-memory and passes it through env → CLI → tRPC,
  // so this path avoids depending on `runningOperation.assistantMessageId`
  // itself being readable on this replica. We still require the topic's
  // runningOperation binding to match `operationId`, otherwise late/retried
  // batches after finish could keep mutating a completed turn.
  // Fall back to topic.metadata for desktop / old-CLI callers that lack the field.
  // `heteroCurrentMsgId` is the last resort and is scoped to this operation:
  // it is the only pointer left once a marker has been cleared out from under
  // a still-running producer (see the liveness check above).
  const currentMsgIdForOperation =
    topic?.metadata?.heteroCurrentMsgId?.operationId === operationId
      ? topic?.metadata?.heteroCurrentMsgId?.msgId
      : undefined;
  const baseAssistantMessageId =
    seedAssistantMessageId ?? running?.assistantMessageId ?? currentMsgIdForOperation;

  if (!baseAssistantMessageId) {
    throw new Error(`runningOperation on topic ${topicId} is missing assistantMessageId`);
  }

  const baseAssistantMessage = await deps.messageModel.findById(baseAssistantMessageId);

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
    sourceUserMessageId: baseAssistantMessage?.parentId ?? undefined,
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
  await refreshToolMessageIndex(deps, state);
  await refreshMainStateFromDb(deps, state);
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

function createEmptyMainToolState(): MainAgentTurnToolState {
  return { payloads: [], persistedIds: new Set(), toolMsgIdByCallId: new Map() };
}

function toAssistantSnapshot(
  message: AssistantMessageDbLike | null | undefined,
): AssistantDbSnapshot {
  const rawContent = (message?.content ?? '') as string;
  const metadata = ((message?.metadata as Record<string, any> | null) ?? {}) as Record<string, any>;
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

function toToolPayload(tool: ChatToolPayload): ToolCallPayload {
  return {
    apiName: tool.apiName,
    arguments: tool.arguments,
    id: tool.id,
    identifier: tool.identifier,
    type: tool.type,
  };
}

function buildMainToolStateFromSnapshot(
  snapshot: AssistantDbSnapshot,
  toolMsgIdByCallId: Map<string, string>,
): MainAgentTurnToolState {
  const toolState = createEmptyMainToolState();
  const seen = new Set<string>();

  for (const tool of snapshot.tools) {
    if (!tool.id || seen.has(tool.id)) continue;
    const toolMessageId = tool.result_msg_id ?? toolMsgIdByCallId.get(tool.id);
    if (!toolMessageId) continue;

    seen.add(tool.id);
    toolState.payloads.push(toToolPayload(tool));
    toolState.persistedIds.add(tool.id);
    toolState.toolMsgIdByCallId.set(tool.id, toolMessageId);
  }

  return toolState;
}

export async function refreshToolMessageIndex(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
): Promise<void> {
  const toolPlugins = await deps.messageModel.listMessagePluginsByTopic(state.topicId);
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
        const provider = INTERVENTION_PROVIDERS.has(metadata.provider as AgentInterventionProvider)
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
export async function refreshMainStateFromDb(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
): Promise<void> {
  const currentMsg = await deps.messageModel.findById(state.main.currentAssistantId);
  const snapshot = toAssistantSnapshot(currentMsg);

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
  restoreHeteroProvenance(state, snapshot.metadata);

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

  const dbToolState = buildMainToolStateFromSnapshot(snapshot, state.toolMsgIdByCallId);
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

  // Recover only THIS operation's spine. A late write from the interrupted
  // producer can be newer than the steered run's seed; using the topic-wide
  // latest row would attach the new reply to the old branch. Reading stamped
  // steps still recovers progress on cold replicas whose pointer is stale.
  // Before the first stamped step, keep the run's seeded/current spine.
  const spineId = await deps.messageModel.getLatestSpineMessageId({
    operationId: state.operationId,
    threadId: state.threadId ?? null,
    topicId: state.topicId,
  });
  if (spineId) state.main.lastSpineMessageId = spineId;
}

/** Spine assistants walked back from the tip; a run's tools sit a hop or two behind it. */
const MAX_SIGNAL_ANCHOR_HOPS = 50;

/**
 * Recover `lastToolMsgIdEver` — the anchor a signal turn (a background task's
 * wake-up) parents off — on a replica that never reduced this run's tool
 * batches. Without it the signal turn falls back onto the toolless spine reply,
 * and the read side, which only collects signal turns under tools, renders it
 * as a separate top-level reply.
 *
 * Walks the spine from its tip back through main-thread assistants and takes
 * the last tool of the first one that called any. Stopping at the first
 * non-assistant (the run's user message) keeps a previous run's tools out.
 */
export async function recoverLastToolMessageFromDb(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
): Promise<void> {
  if (state.main.lastToolMsgIdEver) return;

  const threadId = state.threadId ?? null;
  let messageId: string | null | undefined = state.main.lastSpineMessageId;
  for (let hop = 0; messageId && hop < MAX_SIGNAL_ANCHOR_HOPS; hop++) {
    const message = await deps.messageModel.findById(messageId);
    if (message?.role !== 'assistant' || (message.threadId ?? null) !== threadId) return;

    const toolMessageId = ((message.tools ?? []) as ChatToolPayload[])
      .map((tool) => tool.result_msg_id ?? state.toolMsgIdByCallId.get(tool.id))
      .findLast(Boolean);
    if (toolMessageId) {
      state.main.lastToolMsgIdEver = toolMessageId;
      return;
    }
    messageId = message.parentId;
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
export async function refreshSubagentRunsFromDb(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
): Promise<void> {
  try {
    const threads = await deps.threadModel.queryByTopicId(state.topicId);
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

      const messages = await deps.messageModel.query({
        threadId: thread.id,
        topicId: state.topicId,
      });
      const snapshot = buildSubagentSnapshot(parentToolCallId, thread.id, messages);
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
function buildSubagentSnapshot(
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

export async function syncAssistantPointerForAdvancedStep(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
): Promise<void> {
  const topic = await deps.topicModel.findById(state.topicId);
  const marker = topic?.metadata?.runningOperation;
  const running =
    marker?.operationId === state.operationId
      ? marker
      : marker?.childOperations?.find((child) => child.operationId === state.operationId);

  // Same split as `loadOrCreateState`: another operation on the marker means
  // this run has been superseded and must stop writing, while a marker that
  // is simply gone can be a live producer whose topic was settled by a
  // transport signal. In the latter case `heteroCurrentMsgId` — repointed by
  // this operation's own ingest — is a complete substitute for the pointer
  // this sync would have read off the marker.
  if (
    !running &&
    (marker || !(await deps.isOperationLiveOnTopic?.(state.operationId, state.topicId)))
  ) {
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
    toolState: createEmptyMainToolState(),
    turnMetadata: {},
  };
  await refreshToolMessageIndex(deps, state);
  await refreshMainStateFromDb(deps, state);

  log(
    'synced warm state op=%s to assistant=%s after step advance',
    state.operationId,
    authoritativeAssistantMessageId,
  );
}
