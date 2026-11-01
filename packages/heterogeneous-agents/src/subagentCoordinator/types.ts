import type { ToolCallPayload } from '../types';

/**
 * Subagent run coordinator — shared, side-effect-free state machine for
 * heterogeneous-agent (Claude Code / Codex) subagent runs.
 *
 * Background: both the renderer executor (`heterogeneousAgentExecutor.ts`) and
 * the server persistence handler (`HeterogeneousPersistenceHandler.ts`) used to
 * hand-write the SAME subagent run state machine — lazy Thread create, turn
 * boundary cut on `subagentMessageId` change, finalize on the parent
 * tool_result, orphan drain, chain parenting, turn-scoped vs lifetime tool ids.
 * That duplication was the epicenter of nearly every hetero subagent bug.
 *
 * This module owns the "when to create / cut / finalize" decisions in ONE pure
 * reducer. It performs no I/O: it returns a list of {@link SubagentIntent}s that
 * each environment's interpreter executes against its own persistence + UI
 * surfaces (renderer: DB via messageService + live store dispatch; server:
 * DB via messageModel). The reducer pre-allocates every id (via `ctx.newId`) so
 * intents can carry concrete `parentId` chains with no "create then backfill
 * id" reverse dependency.
 */

// ─── Reducer state ───

/** Per-turn tool persistence state. Reset on every subagent turn boundary. */
export interface SubagentTurnToolState {
  /**
   * Cumulative `tools[]` payloads for the CURRENT in-thread assistant. Carries
   * NO `result_msg_id` — the interpreter backfills that from the pre-allocated
   * tool-message id when it writes the assistant's `tools[]` (phase 3).
   */
  payloads: ToolCallPayload[];
  /** tool_call ids already turned into tool messages this turn (de-dupe). */
  persistedIds: Set<string>;
  /** Pre-allocated tool-message id per tool_call id, for this turn's payloads. */
  toolMsgIdByCallId: Map<string, string>;
}

/**
 * Per-spawn subagent run state, keyed by `parentToolCallId`. Mirrors the
 * `SubagentRunState` that previously lived in both engines, minus the
 * environment-specific I/O handles (store dispatcher, sub-operation id,
 * pendingFlushTarget) which stay in each interpreter.
 */
export interface SubagentRun {
  /** Accumulated text for the current in-thread assistant turn. */
  accContent: string;
  /** Accumulated reasoning (thinking) for the current turn. */
  accReasoning: string;
  /** The in-thread assistant message currently being appended to. */
  currentAssistantId: string;
  /** Adapter `subagentMessageId` for the current turn (change = new assistant). */
  currentSubagentMessageId: string;
  /**
   * Most recent parentId in the thread chain (`user → asst → tool → asst …`).
   * Advances to the last tool message of each batch so the next assistant
   * chains off it — mirrors main-agent step-boundary parenting.
   */
  lastChainParentId: string;
  /**
   * Run-lifetime set of every inner tool_call_id this subagent has persisted.
   * Unlike per-turn `toolState.persistedIds` (wiped on turn boundary), this
   * only grows, so a delayed `tool_result` landing after its owning turn rolled
   * over still resolves back to the right run.
   */
  lifetimeToolCallIds: Set<string>;
  /** The subagent Thread this spawn's messages belong to. */
  threadId: string;
  /** Per-turn tool persistence state. */
  toolState: SubagentTurnToolState;
  /**
   * Every adapter `subagentMessageId` this run has opened an assistant for.
   * Carried into {@link FinalizedSubagentRun} so a replay of one of these turns
   * after finalize stays a no-op instead of reopening the thread.
   */
  turnIds: Set<string>;
}

/**
 * What a finalized run leaves behind so the same subagent can resume later.
 * CC's `SendMessage` wakes a completed subagent and its events keep the
 * original `parentToolCallId`; a NEW turn id reopens the thread and chains
 * onto `lastChainParentId`, while a known turn id is a stale replay.
 */
export interface FinalizedSubagentRun {
  lastChainParentId: string;
  lifetimeToolCallIds: Set<string>;
  threadId: string;
  turnIds: Set<string>;
}

export interface SubagentRunsState {
  /**
   * `parentToolCallId`s whose subagent already FINALIZED (thread is `Active`).
   * The run itself is deleted from `runs` on finalize, but the parent is
   * remembered here so a REPLAYED first-event (cold-replica retry, double IPC
   * delivery) does NOT fork a brand-new duplicate thread for a spawn that is
   * already done. Distinct from `runs` on purpose: finalized spawns must block
   * re-creation WITHOUT being resurrected into the live turn machinery (which
   * would mint spurious empty assistants / re-finalize churn). Survives turn
   * boundaries; on the server it is reseeded from DB `Active` isolation threads.
   */
  finalizedParents: Set<string>;
  /**
   * Resume anchors for finalized parents, keyed by `parentToolCallId`. A
   * finalized parent without an anchor (e.g. a cold replica that only knows
   * the thread is `Active`) cannot resume and drops every event.
   */
  finalizedRuns: Map<string, FinalizedSubagentRun>;
  /** Active subagent runs, keyed by `parentToolCallId`. */
  runs: Map<string, SubagentRun>;
}

export const createSubagentRunsState = (): SubagentRunsState => ({
  finalizedParents: new Set(),
  finalizedRuns: new Map(),
  runs: new Map(),
});

/**
 * DB-derived snapshot of one in-flight subagent run, used to rebuild a
 * {@link SubagentRun} after the in-memory coordinator state was lost.
 *
 * Why this exists: the desktop renderer keeps one long-lived `SubagentRunsState`
 * closure for a whole CC run, so its `runs` map always has the entry for an
 * active spawn. The server (`HeterogeneousPersistenceHandler`) keeps per-operation
 * state in a module-level map that a COLD serverless replica starts empty — and
 * if that empty state reaches `reduce`, the next subagent event hits the
 * `!existing` branch of `ensureRun` and forks a BRAND-NEW thread for a
 * `parentToolCallId` that already has one (the "大量无意义的 Subagent" bug). The
 * server rebuilds main-agent state from DB on cold start; this lets it rebuild
 * the subagent runs the same way.
 *
 * Only the fields needed to keep the run attached to its EXISTING thread and to
 * its IN-FLIGHT turn are required. `currentSubagentMessageId` is recovered from
 * the latest in-thread assistant's persisted `metadata.subagentMessageId`: a
 * cold replica must know the in-flight turn's CC `message.id`, otherwise the
 * next event (`'' !== realId`) reads as a spurious turn boundary and splits one
 * CC turn across multiple assistant rows (text on one, tools on another) plus
 * empty shells. When the latest assistant predates this field (or is the
 * terminal result row), it's omitted and falls back to `''` — same single-extra-
 * turn behavior as before, no duplicate thread.
 */
export interface SubagentRunSnapshot {
  /** Persisted text of the in-flight turn, so a continuation appends instead of replacing it. */
  accContent?: string;
  /** Persisted reasoning of the in-flight turn. */
  accReasoning?: string;
  /** Latest in-thread assistant id (where a continuation turn would otherwise append). */
  currentAssistantId: string;
  /** CC `message.id` of the in-flight turn, from the latest assistant's `metadata.subagentMessageId`. */
  currentSubagentMessageId?: string;
  /** Chain anchor for the next turn's assistant — last tool row of the thread, else the assistant. */
  lastChainParentId?: string;
  /** Every inner tool_call_id already persisted in the thread (delayed tool_results resolve via this). */
  lifetimeToolCallIds?: string[];
  /** The spawn tool_use id (`thread.metadata.sourceToolCallId`) — the run key. */
  parentToolCallId: string;
  /** The existing isolation Thread this run owns. */
  threadId: string;
  /** Every `subagentMessageId` already persisted in the thread. */
  turnIds?: string[];
  /** Tools already on the in-flight assistant, so a cumulative `tools_calling` keeps them. */
  turnTools?: { payload: ToolCallPayload; toolMessageId: string }[];
}

/** DB-derived snapshot of a finalized run, used to rebuild its {@link FinalizedSubagentRun}. */
export interface FinalizedSubagentRunSnapshot {
  /** The thread's latest non-tool message, where a resumed turn chains on. */
  lastChainParentId: string;
  lifetimeToolCallIds?: string[];
  parentToolCallId: string;
  threadId: string;
  turnIds?: string[];
}

/** Rebuild one live {@link SubagentRun} from its DB snapshot. */
export const restoreSubagentRun = (s: SubagentRunSnapshot): SubagentRun => {
  const turnTools = s.turnTools ?? [];
  return {
    accContent: s.accContent ?? '',
    accReasoning: s.accReasoning ?? '',
    currentAssistantId: s.currentAssistantId,
    currentSubagentMessageId: s.currentSubagentMessageId ?? '',
    lastChainParentId: s.lastChainParentId ?? s.currentAssistantId,
    lifetimeToolCallIds: new Set(s.lifetimeToolCallIds ?? []),
    threadId: s.threadId,
    toolState: {
      payloads: turnTools.map(({ payload }) => ({ ...payload })),
      persistedIds: new Set(turnTools.map(({ payload }) => payload.id)),
      toolMsgIdByCallId: new Map(
        turnTools.map(({ payload, toolMessageId }) => [payload.id, toolMessageId]),
      ),
    },
    turnIds: new Set(s.turnIds ?? []),
  };
};

/** Rebuild one {@link FinalizedSubagentRun} resume anchor from its DB snapshot. */
export const restoreFinalizedSubagentRun = (
  s: FinalizedSubagentRunSnapshot,
): FinalizedSubagentRun => ({
  lastChainParentId: s.lastChainParentId,
  lifetimeToolCallIds: new Set(s.lifetimeToolCallIds ?? []),
  threadId: s.threadId,
  turnIds: new Set(s.turnIds ?? []),
});

/**
 * Rebuild a {@link SubagentRunsState} from DB-derived snapshots of in-flight
 * runs. Use on a cold start so a continuing subagent reuses its existing thread
 * instead of forking a new one. The in-flight turn's text and tools come back
 * from the snapshot when provided; inner tool_results resolve through
 * `lifetimeToolCallIds`.
 *
 * `finalizedParentToolCallIds` seeds {@link SubagentRunsState.finalizedParents}
 * — `parentToolCallId`s whose thread already finalized (`Active`). These are NOT
 * live runs (a completed spawn is never resurrected); they only block a replayed
 * first-event from forking a duplicate thread on a cold replica.
 * `finalizedRuns` adds resume anchors for the finalized parents that may resume.
 */
export const rehydrateSubagentRunsState = (
  snapshots: SubagentRunSnapshot[],
  finalizedParentToolCallIds: string[] = [],
  finalizedRuns: FinalizedSubagentRunSnapshot[] = [],
): SubagentRunsState => ({
  finalizedParents: new Set([
    ...finalizedParentToolCallIds,
    ...finalizedRuns.map((s) => s.parentToolCallId),
  ]),
  finalizedRuns: new Map(
    finalizedRuns.map((s) => [s.parentToolCallId, restoreFinalizedSubagentRun(s)]),
  ),
  runs: new Map(snapshots.map((s) => [s.parentToolCallId, restoreSubagentRun(s)])),
});

// ─── Reduce context (per event) ───

/**
 * Per-event context the interpreter supplies. `mainAssistantId` / `topicId` /
 * `agentId` describe the MAIN-agent state at the moment the subagent event is
 * processed (the thread's `sourceMessageId` and the user-seed `parentId` both
 * point at the main assistant that spawned the Task). `newId` pre-allocates an
 * environment-appropriate, DB-compatible id.
 */
export interface SubagentReduceCtx {
  agentId?: string | null;
  /** Main-agent assistant id that spawned this subagent (for thread + seed parenting). */
  mainAssistantId: string;
  /** Allocate a prefixed id (`thd_…` / `msg_…`). Deterministic counter in tests. */
  newId: (kind: 'thread' | 'message') => string;
  topicId: string | null;
}

// ─── Intents ───

/**
 * Declarative "what happened" instructions. Each interpreter maps these to its
 * own I/O. Two content intents (`streamContent` live vs `persistContent`
 * durable) are intentional: the renderer applies `streamContent` to its thread
 * store bucket for token-level UI and only writes DB on `persistContent` /
 * `persistToolBatch`; the server no-ops `streamContent` and persists only on
 * `persistContent` / `persistToolBatch` (one DB write per token would be wasteful).
 */
export type SubagentIntent =
  | CreateThreadIntent
  | CreateMessageIntent
  | StreamContentIntent
  | PersistContentIntent
  | PersistToolBatchIntent
  | UpdateToolStateIntent
  | ResolveToolResultIntent
  | RecordUsageIntent
  | FinalizeThreadIntent
  | ReopenThreadIntent;

/** Lazy-create the subagent Thread (status Processing). */
export interface CreateThreadIntent {
  kind: 'createThread';
  parentToolCallId: string;
  /** Main assistant that spawned this subagent. */
  sourceMessageId: string;
  sourceToolCallId: string;
  subagentType?: string;
  threadId: string;
  title: string;
  topicId: string | null;
}

/**
 * Create an in-thread message — the user seed (role `user`), each turn's
 * assistant, or the terminal result assistant (role `assistant`). The renderer
 * also dispatches this into its thread store bucket for live display.
 */
export interface CreateMessageIntent {
  agentId?: string | null;
  content: string;
  kind: 'createMessage';
  messageId: string;
  parentId: string;
  role: 'user' | 'assistant';
  /**
   * CC's per-turn `message.id` for an `assistant` turn row. Persisted (server:
   * onto `metadata.subagentMessageId`) so a cold serverless replica can recover
   * {@link SubagentRun.currentSubagentMessageId} via {@link SubagentRunSnapshot}
   * and recognize a CONTINUING turn instead of forcing a spurious turn boundary
   * — which would split one CC turn across multiple in-thread assistant rows
   * (text on one, tools on another) and leave empty shells. Absent on the user
   * seed and the terminal result assistant.
   */
  subagentMessageId?: string;
  threadId: string;
  topicId: string | null;
}

/** Live in-memory content update (replace). Renderer applies; server no-ops. */
export interface StreamContentIntent {
  content?: string;
  kind: 'streamContent';
  messageId: string;
  reasoning?: string;
  threadId: string;
}

/** Durable content/reasoning flush (turn boundary / finalize). Both persist. */
export interface PersistContentIntent {
  content?: string;
  kind: 'persistContent';
  messageId: string;
  reasoning?: string;
  threadId: string;
}

/** A single tool in a {@link PersistToolBatchIntent}. */
export interface PersistToolBatchEntry {
  /** True when this tool's row must be created this batch (not seen before). */
  isNew: boolean;
  payload: ToolCallPayload;
  /** Pre-allocated tool-message id; row is created with this id when `isNew`. */
  toolMessageId: string;
}

/**
 * Persist a batch of subagent tool calls into the thread-scoped assistant.
 * Interpreter runs the 3-phase write: (1) `assistant.tools[]` without
 * result_msg_id, (2) create rows for `isNew` entries with their pre-allocated
 * ids + populate the tool-message lookup map, (3) re-write `assistant.tools[]`
 * with `result_msg_id` backfilled from each entry's `toolMessageId`.
 */
export interface PersistToolBatchIntent {
  assistantMessageId: string;
  /** Latest accumulated content snapshot to persist alongside the tools. */
  content?: string;
  kind: 'persistToolBatch';
  reasoning?: string;
  /**
   * CC `message.id` of the turn these tools belong to, so the interpreter can
   * stamp `metadata.heteroMessageId` on each new tool row (mirrors the id it
   * stamps on the turn's assistant via {@link CreateMessageIntent}).
   */
  subagentMessageId?: string;
  threadId: string;
  tools: PersistToolBatchEntry[];
}

/** Replace the live/durable plugin state for a still-running inner tool. */
export interface UpdateToolStateIntent {
  kind: 'updateToolState';
  pluginState: Record<string, unknown>;
  snapshotSeq: number;
  threadId: string;
  toolCallId: string;
}

/**
 * Resolve an inner subagent tool_result. The interpreter looks up the
 * tool-message id from its own `toolCallId → messageId` map (populated by
 * `persistToolBatch` phase 2; on the server it is also DB-backed so a
 * cross-replica result still lands).
 */
export interface ResolveToolResultIntent {
  content: string;
  isError: boolean;
  kind: 'resolveToolResult';
  pluginState?: Record<string, any>;
  threadId: string;
  toolCallId: string;
}

/** Attach per-turn usage/model/provider to the current in-thread assistant. */
export interface RecordUsageIntent {
  kind: 'recordUsage';
  messageId: string;
  model?: string;
  provider?: string;
  /**
   * CC `message.id` of the turn whose usage this is. recordUsage overwrites the
   * assistant row's metadata wholesale, so it must re-stamp `heteroMessageId`
   * or the value {@link CreateMessageIntent} wrote would be wiped (mirrors the
   * main-agent recordUsage re-stamp).
   */
  subagentMessageId?: string;
  threadId: string;
  usage: unknown;
}

/** Mark the subagent Thread complete (Processing → Active). */
export interface FinalizeThreadIntent {
  kind: 'finalizeThread';
  threadId: string;
}

/** A finalized subagent resumed: mark its Thread running again (Active → Processing). */
export interface ReopenThreadIntent {
  kind: 'reopenThread';
  threadId: string;
}
