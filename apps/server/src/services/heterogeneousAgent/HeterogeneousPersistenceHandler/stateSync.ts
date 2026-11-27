import {
  type AgentInterventionInteractionKind,
  type AgentInterventionProvider,
} from '@lobechat/agent-gateway-client';
import { LOADING_FLAT } from '@lobechat/const';
import type {
  MainAgentInterventionTransition,
  MainAgentTurnToolState,
  SubagentRun,
  SubagentThreadMessage,
  ToolCallPayload,
} from '@lobechat/heterogeneous-agents';
import {
  buildFinalizedSubagentRunSnapshot,
  buildSubagentRunSnapshot,
  createMainAgentRunState,
  restoreFinalizedSubagentRun,
  restoreSubagentRun,
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

/**
 * Metadata key each replica stamps on the current assistant at the end of a
 * batch it ingested. Comparing it with the stamp this replica last saw tells a
 * warm replica whether another one ingested this run in between.
 */
export const HETERO_INGEST_STAMP_KEY = 'heteroIngestStamp';

/**
 * How far before the previous index read an incremental read starts. Covers
 * clock skew between replicas and the DB, and transactions that committed
 * after that read with an older `updated_at`.
 */
const TOOL_INDEX_SINCE_OVERLAP_MS = 10_000;

interface AssistantDbSnapshot {
  content: string;
  /** `heteroIngestStamp` of the row, kept out of `metadata` so turns never copy it. */
  ingestStamp: string | undefined;
  metadata: Record<string, any>;
  model: string | undefined;
  provider: string | undefined;
  reasoning: string;
  reasoningSnapshotSeq: number;
  textSnapshotSeq: number;
  tools: ChatToolPayload[];
}

interface AssistantMessageDbLike {
  content?: unknown;
  metadata?: unknown;
  model?: string | null;
  provider?: string | null;
  reasoning?: { content?: string } | null;
  tools?: unknown;
}

/**
 * The assistant row this operation currently writes to, per the topic: the
 * step pointer `heteroCurrentMsgId` when it belongs to this operation, else
 * the running marker's assistant.
 */
const topicAssistantPointer = (
  topic: Awaited<ReturnType<HeterogeneousPersistenceHandlerDeps['topicModel']['findById']>>,
  operationId: string,
  running: { assistantMessageId?: string } | undefined,
): string | undefined => {
  const stored = topic?.metadata?.heteroCurrentMsgId;
  return stored?.operationId === operationId
    ? (stored.msgId ?? running?.assistantMessageId)
    : running?.assistantMessageId;
};

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
  if (state) {
    state.topicCurrentMsgId = topicAssistantPointer(topic, operationId, running);
    return state;
  }

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
    steerMessages: new Map(),
    streamStartAssistantIds: new Map(),
    streamStartParentMessages: new Map(),
    toolMsgIdByCallId: new Map(),
    // A sub-agent run in an isolation thread is only in the topic marker while
    // its parent's turn runs (never once a background child outlives it); its
    // seeded assistant message always sits in that thread.
    threadId: running?.threadId ?? baseAssistantMessage?.threadId ?? undefined,
    topicCurrentMsgId: topicAssistantPointer(topic, operationId, running),
    topicId,
  };
  await syncToolIndexAndMainState(deps, state, { forceFull: true });
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
  const { [HETERO_INGEST_STAMP_KEY]: rawStamp, ...metadata } = ((message?.metadata as Record<
    string,
    any
  > | null) ?? {}) as Record<string, any>;
  const textSnapshotSeq = Number(metadata.heteroTextSnapshotSeq ?? 0);
  const reasoningSnapshotSeq = Number(metadata.heteroReasoningSnapshotSeq ?? 0);
  return {
    content: rawContent === LOADING_FLAT ? '' : rawContent,
    ingestStamp: typeof rawStamp === 'string' ? rawStamp : undefined,
    metadata,
    model: message?.model ?? undefined,
    provider: message?.provider ?? undefined,
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

/**
 * Rebuild the topic-wide tool index (toolCallId → message id, this
 * operation's interventions and tool-state watermarks) from every tool row.
 * Used whenever the in-memory index may be stale; warm batches use
 * {@link mergeToolMessageIndexSince} instead.
 */
export async function refreshToolMessageIndex(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
): Promise<void> {
  // Read only the index columns, not every tool's arguments and state.
  const toolPlugins = await deps.messageModel.listToolCallIndexByTopic(state.topicId, {
    interventionStateKey: HETEROGENEOUS_INTERVENTION_STATE_KEY,
  });
  mergeToolIndexRows(state, toolPlugins);
}

/**
 * Merge only the tool rows written since `sinceMs` into the index, plus every
 * row this operation holds an intervention for. Those rows are re-read by id
 * because intervention writes touch only `message_plugins` and leave
 * `messages.updated_at` unchanged, and a Web client can write them too.
 */
export async function mergeToolMessageIndexSince(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
  sinceMs: number,
): Promise<void> {
  const ids = [...state.main.interventionsByCallId.keys()]
    .map((toolCallId) => state.toolMsgIdByCallId.get(toolCallId))
    .filter((id): id is string => !!id);
  const toolPlugins = await deps.messageModel.listToolCallIndexByTopicSince(state.topicId, {
    ids,
    interventionStateKey: HETEROGENEOUS_INTERVENTION_STATE_KEY,
    since: new Date(sinceMs),
  });
  mergeToolIndexRows(state, toolPlugins);
}

type ToolCallIndexRows = Awaited<
  ReturnType<HeterogeneousPersistenceHandlerDeps['messageModel']['listToolCallIndexByTopic']>
>;

/** Same merge for full and incremental reads: later rows win, watermarks only grow. */
function mergeToolIndexRows(state: OperationState, toolPlugins: ToolCallIndexRows): void {
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

        if (
          transition &&
          (plugin.intervention?.operationId ??
            metadata.operationId ??
            plugin.metadata?.operationId) === state.operationId
        ) {
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
  preloaded?: AssistantDbSnapshot,
): Promise<void> {
  const snapshot = preloaded ?? (await loadAssistantSnapshot(deps, state.main.currentAssistantId));

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

async function loadAssistantSnapshot(
  deps: HeterogeneousPersistenceHandlerDeps,
  messageId: string,
): Promise<AssistantDbSnapshot> {
  return toAssistantSnapshot(await deps.messageModel.findAssistantSnapshotById(messageId));
}

/**
 * Bring the tool index and the current assistant's reducer state up to date
 * with the DB before a batch is reduced.
 *
 * Batches of one run can land on different serverless replicas, each holding
 * its own `operationStates`, so a warm replica may have missed tool rows,
 * intervention transitions and tool-state watermarks another replica wrote.
 * That is why the index used to be rebuilt from every tool row of the topic on
 * each batch. Its own writes, by contrast, are already in memory.
 *
 * The full rebuild now runs only when another writer may have run:
 * - no trusted sync yet (bootstrap, after a failed batch) or `forceFull`;
 * - the current assistant's ingest stamp differs from the one this replica
 *   last saw or wrote, i.e. another replica flushed a batch in between;
 * - the topic's turn pointer no longer names the assistant this replica
 *   writes to.
 * Otherwise only rows touched since the previous read (with a safety window)
 * and this operation's intervention rows are merged.
 *
 * The stamp is read before the index, so a write racing the read leaves the
 * older stamp behind and the next batch rebuilds again.
 */
export async function syncToolIndexAndMainState(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
  { forceFull = false }: { forceFull?: boolean } = {},
): Promise<void> {
  const snapshot = await loadAssistantSnapshot(deps, state.main.currentAssistantId);
  const sync = state.toolIndexSync;
  const pointerMoved =
    state.topicCurrentMsgId !== undefined &&
    state.topicCurrentMsgId !== state.main.currentAssistantId;
  const startedAt = Date.now();

  if (!forceFull && sync && sync.stamp === snapshot.ingestStamp && !pointerMoved) {
    await mergeToolMessageIndexSince(deps, state, sync.at - TOOL_INDEX_SINCE_OVERLAP_MS);
  } else {
    log(
      'full tool index refresh op=%s reason=%s',
      state.operationId,
      forceFull ? 'forced' : !sync ? 'untrusted' : pointerMoved ? 'pointer' : 'handoff',
    );
    await refreshToolMessageIndex(deps, state);
  }
  state.toolIndexSync = { at: startedAt, stamp: snapshot.ingestStamp };

  await refreshMainStateFromDb(deps, state, snapshot);
}

/** Spine assistants walked back from the tip; a run's tools sit a hop or two behind it. */
const MAX_SIGNAL_ANCHOR_HOPS = 50;

/**
 * Recover `lastToolMsgIdEver` — the anchor a signal turn (a background task's
 * wake-up) parents off — from the DB instead of trusting this replica's memory.
 *
 * A replica that never reduced this run's tool batches has no anchor, so the
 * signal turn falls back onto the toolless spine reply, and the read side, which
 * only collects signal turns under tools, renders it as a separate top-level
 * reply. A warm replica can hold an anchor that another replica has since moved
 * past (an earlier wake-up called a tool there), which puts the wake-up under an
 * older tool next to the earlier one. The DB is current in both cases.
 *
 * Walks the spine from its tip back through main-thread assistants and takes
 * the last tool of the first one that called any. Stopping at the first
 * non-assistant (the run's user message) keeps a previous run's tools out. When
 * the walk finds no tool, the in-memory anchor stays.
 */
export async function recoverLastToolMessageFromDb(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
): Promise<void> {
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

async function loadThreadMessages(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
  threadId: string,
): Promise<SubagentThreadMessage[]> {
  return (await deps.messageModel.query({
    threadId,
    topicId: state.topicId,
  })) as SubagentThreadMessage[];
}

/**
 * Reconcile the subagent runs (`state.main.subagents`) with the DB before a
 * batch is reduced. The DB decides where each thread ends; memory only keeps
 * the accumulators of a turn that is still the thread's tail.
 *
 * Serverless replicas each hold their own `operationStates`, and batches of one
 * run spread across them. Three cases follow:
 *
 * - Cold replica (run missing): the reducer would hit `!existing` and fork a
 *   brand-new thread — the "大量无意义的 Subagent" bug. Rebuild the run.
 * - Warm replica behind the thread's tail (another replica opened newer
 *   turns): its stale `lastChainParentId` would parent the next turn onto an
 *   old node and fork the chain. Rebuild the run.
 * - Warm replica still at the tail: keep its accumulators, but adopt text
 *   another replica appended to this same turn.
 *
 * Rebuilt runs restore the in-flight turn's text and tools too, so a
 * continuation appends to them instead of replacing them.
 *
 * Finalized (`Active`) spawns are never live runs (resurrecting one would mint
 * spurious empty assistants and re-finalize churn), and a warm copy of one is
 * dropped. Their `sourceToolCallId` IS recorded in `finalizedParents` so a
 * REPLAYED first-event can't fork a duplicate thread (the "一模一样的两个
 * thread" bug) — dedup keyed by the DB-homed `sourceToolCallId`, independent
 * of in-memory state. When the batch carries events for a finalized parent
 * (`referencedParents`), its resume anchor is rebuilt from the thread so a
 * subagent woken by `SendMessage` continues the thread from its tail.
 *
 * Best-effort: any DB hiccup (or a partial test mock without the query
 * methods) leaves `state.main.subagents` untouched rather than aborting the
 * whole ingest.
 */
export async function refreshSubagentRunsFromDb(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
  referencedParents: ReadonlySet<string> = new Set(),
): Promise<void> {
  try {
    const threads = await deps.threadModel.queryByTopicId(state.topicId);
    const runs = new Map(state.main.subagents.runs);
    const finalizedParents = new Set(state.main.subagents.finalizedParents);
    const finalizedRuns = new Map(state.main.subagents.finalizedRuns);

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
      if (!parentToolCallId) continue;

      if (thread.status !== ThreadStatus.Processing) {
        runs.delete(parentToolCallId);
        finalizedParents.add(parentToolCallId);
        if (referencedParents.has(parentToolCallId)) {
          const messages = await loadThreadMessages(deps, state, thread.id);
          const anchor = buildFinalizedSubagentRunSnapshot(parentToolCallId, thread.id, messages);
          if (anchor) finalizedRuns.set(parentToolCallId, restoreFinalizedSubagentRun(anchor));
        }
        continue;
      }

      // Processing — possibly reopened by another replica since this one finalized it.
      finalizedParents.delete(parentToolCallId);
      finalizedRuns.delete(parentToolCallId);

      const run = runs.get(parentToolCallId);
      const tailId = await deps.messageModel.getLatestSpineMessageId({
        threadId: thread.id,
        topicId: state.topicId,
      });
      if (run && tailId === run.currentAssistantId) {
        const tail = (await deps.messageModel.findById(tailId)) as
          SubagentThreadMessage | undefined;
        runs.set(parentToolCallId, adoptPersistedTurnText(run, tail));
        continue;
      }

      const messages = await loadThreadMessages(deps, state, thread.id);
      const snapshot = buildSubagentRunSnapshot(parentToolCallId, thread.id, messages);
      if (snapshot) runs.set(parentToolCallId, restoreSubagentRun(snapshot));
    }

    state.main = { ...state.main, subagents: { finalizedParents, finalizedRuns, runs } };
  } catch (err) {
    log('refreshSubagentRunsFromDb failed op=%s err=%O', state.operationId, err);
  }
}

/**
 * Subagent text arrives as deltas, so a longer persisted text means another
 * replica appended to this turn after this replica last saw it.
 */
function adoptPersistedTurnText(
  run: SubagentRun,
  tail: SubagentThreadMessage | undefined,
): SubagentRun {
  const content = tail?.content ?? '';
  const reasoning = tail?.reasoning?.content ?? '';
  if (content.length <= run.accContent.length && reasoning.length <= run.accReasoning.length) {
    return run;
  }
  return {
    ...run,
    accContent: content.length > run.accContent.length ? content : run.accContent,
    accReasoning: reasoning.length > run.accReasoning.length ? reasoning : run.accReasoning,
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

  const authoritativeAssistantMessageId = topicAssistantPointer(topic, state.operationId, running);
  state.topicCurrentMsgId = authoritativeAssistantMessageId;

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
  await syncToolIndexAndMainState(deps, state, { forceFull: true });

  log(
    'synced warm state op=%s to assistant=%s after step advance',
    state.operationId,
    authoritativeAssistantMessageId,
  );
}
