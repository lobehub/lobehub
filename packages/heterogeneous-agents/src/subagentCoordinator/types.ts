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
}

export interface SubagentRunsState {
  /** Active subagent runs, keyed by `parentToolCallId`. */
  runs: Map<string, SubagentRun>;
}

export const createSubagentRunsState = (): SubagentRunsState => ({
  runs: new Map(),
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
  | ResolveToolResultIntent
  | RecordUsageIntent
  | FinalizeThreadIntent;

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
  threadId: string;
  tools: PersistToolBatchEntry[];
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
  threadId: string;
  usage: unknown;
}

/** Mark the subagent Thread complete (Processing → Active). */
export interface FinalizeThreadIntent {
  kind: 'finalizeThread';
  threadId: string;
}
