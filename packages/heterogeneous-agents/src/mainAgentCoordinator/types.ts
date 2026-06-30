import type { PersistToolBatchEntry, SubagentRunsState } from '../subagentCoordinator';
import { createSubagentRunsState } from '../subagentCoordinator';
import type { ExternalSignalContext, ToolCallPayload } from '../types';

/**
 * Main-agent run coordinator — shared, side-effect-free state machine for the
 * MAIN (non-subagent) thread of a heterogeneous-agent (Claude Code / Codex) run.
 *
 * Background: the renderer executor (`heterogeneousAgentExecutor.ts`) and the
 * server persistence handler (`HeterogeneousPersistenceHandler.ts`) each
 * hand-wrote the SAME main-agent state machine — content accumulation, step
 * (turn) boundary, the `asst → tool → asst → tool` parent chain, 3-phase tool
 * persist, tool_result resolution, terminal flush. That duplication is exactly
 * how the two diverged: the renderer carries a run-lifetime `lastToolMsgIdEver`
 * fallback that re-mounts toolless reactive turns (Monitor stdout pushes) onto
 * the source tool so `MessageCollector.collectAssistantChain` keeps walking;
 * the server lacked it and, on a cold serverless replica, fell back to chaining
 * `asst → asst`, which forks the wire into disconnected bubbles (the remote
 * "broken chain" bug).
 *
 * This module owns the "when to open a turn / persist / resolve / finalize"
 * decisions in ONE pure reducer, mirroring `subagentCoordinator`. It performs
 * no I/O: it returns a list of intents that each environment's interpreter
 * executes against its own persistence + UI surfaces. The reducer pre-allocates
 * every id (`ctx.newId`) so intents carry concrete `parentId` chains with no
 * "create then backfill id" round-trip. It also OWNS the nested subagent runs
 * by delegating subagent-scoped events to `reduceSubagentRuns`, so a single
 * `reduce` call is the only entry point both engines need.
 *
 * The CHAIN RULE lives here and is authoritative for both engines:
 * the next turn's assistant parents off the most recent NON-tool,
 * NON-signal main-thread message — the run's "spine" (`lastSpineMessageId`) —
 * so the persisted shape is `user → asst → asst …` with tools as inline
 * children. The read side (`conversation-flow`) reconstructs the
 * `asst → tool → asst` zigzag from this. The one exception is signal-tagged
 * reactive turns (Monitor stdout pushes), which parent off the run's most
 * recent tool (`lastToolMsgIdEver`) so the reader renders them as tool-child
 * callbacks rather than spine turns. On a cold serverless replica the spine
 * pointer is recovered from the DB (most recent non-tool main message), which
 * is fork-resistant — it does NOT depend on the in-memory current-assistant
 * pointer that can regress mid-run.
 */

// ─── Reducer state ───

/** Per-turn tool persistence state. Reset on every turn (step) boundary. */
export interface MainAgentTurnToolState {
  /**
   * Cumulative `tools[]` payloads for the CURRENT turn's assistant. Carries NO
   * `result_msg_id` — the interpreter backfills that from the pre-allocated
   * tool-message id when it writes the assistant's `tools[]` (phase 3).
   */
  payloads: ToolCallPayload[];
  /** tool_call ids already turned into tool messages this turn (de-dupe). */
  persistedIds: Set<string>;
  /** Pre-allocated tool-message id per tool_call id, for this turn's payloads. */
  toolMsgIdByCallId: Map<string, string>;
}

/**
 * Per-run main-agent state. Lifetime spans the whole CLI run. Designed to be
 * fully RE-HYDRATABLE from the DB so a stateless server replica can project it
 * and run the same pure reduce as the long-lived renderer process.
 */
export interface MainAgentRunState {
  /** Accumulated text for the current turn's assistant. */
  accContent: string;
  /** Accumulated reasoning (thinking) for the current turn. */
  accReasoning: string;
  /** The main-agent assistant message currently being appended to. */
  currentAssistantId: string;
  /**
   * CC `message.id` of the turn currently open on `currentAssistantId`. The
   * turn's idempotency key: a `stream_start { newStep }` whose `messageId`
   * EQUALS this is a replay of an already-opened turn (e.g. a BatchIngester
   * retry reprocessed on a cold serverless replica, where `processedKeys` is
   * empty) and must NOT mint a second assistant. Recovered on a cold replica
   * from the current assistant's `metadata.mainMessageId`. Undefined for the
   * host-seeded first turn (which never opens via `newStep`, so can't fork).
   */
  currentMainMessageId: string | undefined;
  /** Set once a terminal event has been reduced (idempotent finalize). */
  ended: boolean;
  /**
   * Chain rule: the most recent NON-tool, NON-signal
   * main-thread message — the run's spine. The next NORMAL turn's assistant
   * parents off this (signal-tagged reactive turns parent off `lastToolMsgIdEver`
   * instead). Advances on every normal turn; a signal turn does NOT advance it,
   * so a normal continuation after a Monitor-callback burst re-mounts on the
   * pre-callback spine assistant, not on a callback. Seeded to the placeholder
   * assistant; recovered from the DB on a cold replica (fork-resistant).
   */
  lastSpineMessageId: string;
  /** Highest seen text snapshot sequence (replace-mode de-dup). */
  lastTextSnapshotSeq: number;
  /**
   * Run-lifetime id of the most recent main-agent tool message. Since
   * this anchors ONLY signal-tagged reactive turns (Monitor
   * stdout pushes) onto a tool, so the reader renders them as tool-child
   * callbacks; normal turns parent off `lastSpineMessageId`. Only advances on
   * tool batches; never reset across turns.
   */
  lastToolMsgIdEver: string | undefined;
  /** Nested subagent runs — delegated to `reduceSubagentRuns`. */
  subagents: SubagentRunsState;
  /** Per-turn tool persistence state. */
  toolState: MainAgentTurnToolState;
  /** Accumulated metadata (usage, snapshot seq) for the current assistant. */
  turnMetadata: Record<string, any>;
  /** Latest model id for the run (carried across turns until overwritten). */
  turnModel: string | undefined;
  /** Latest provider for the run (carried across turns until overwritten). */
  turnProvider: string | undefined;
}

/**
 * Seed a fresh run state. `seedAssistantId` is the placeholder assistant the
 * host already created (renderer: `conversationLifecycle`; server:
 * `aiAgent.execAgent`) before the first stream event — the reducer never
 * creates the first assistant, only subsequent turns.
 */
export const createMainAgentRunState = (seedAssistantId: string): MainAgentRunState => ({
  accContent: '',
  accReasoning: '',
  currentAssistantId: seedAssistantId,
  currentMainMessageId: undefined,
  ended: false,
  lastSpineMessageId: seedAssistantId,
  lastTextSnapshotSeq: 0,
  lastToolMsgIdEver: undefined,
  subagents: createSubagentRunsState(),
  toolState: { payloads: [], persistedIds: new Set(), toolMsgIdByCallId: new Map() },
  turnMetadata: {},
  turnModel: undefined,
  turnProvider: undefined,
});

// ─── Reduce context (per event) ───

/**
 * Per-event context the interpreter supplies. `mainAssistantId` is NOT here —
 * it lives in the reducer state (`currentAssistantId`) and is forwarded to the
 * subagent coordinator on delegation. `newId` pre-allocates a DB-compatible id;
 * `'thread'` is forwarded to the subagent coordinator for thread creation.
 */
export interface MainAgentReduceCtx {
  agentId?: string | null;
  /** Allocate a prefixed id (`thd_…` / `msg_…`). Deterministic counter in tests. */
  newId: (kind: 'message' | 'thread') => string;
  topicId: string | null;
}

// ─── Intents ───

/**
 * Declarative "what happened" instructions for the MAIN agent. Each interpreter
 * maps these to its own I/O. The vocabulary deliberately overlaps
 * `SubagentIntent` (a `reduce` call returns a mix of both — main-scoped here
 * plus any subagent intents from delegation) so one interpreter can serve both.
 *
 * The live (`streamContent`) vs durable (`persistAssistant` / `persistToolBatch`)
 * split is intentional: the renderer applies `streamContent` to its live store
 * for token-level UI and writes the DB only on the durable intents; the server
 * no-ops `streamContent` (one DB write per token would be wasteful).
 */
export type MainAgentIntent =
  | CreateAssistantIntent
  | PersistAssistantIntent
  | MainStreamContentIntent
  | MainPersistToolBatchIntent
  | MainResolveToolResultIntent
  | MainRecordUsageIntent
  | SetErrorIntent;

/** Open a new turn's assistant message, chained off the computed `parentId`. */
export interface CreateAssistantIntent {
  agentId?: string | null;
  kind: 'createAssistant';
  /**
   * CC `message.id` of the turn this assistant represents. The interpreter
   * stamps it on `metadata.mainMessageId` so a cold replica can recover
   * {@link MainAgentRunState.currentMainMessageId} and dedupe a replayed
   * `newStep` (mirrors the subagent path's `metadata.subagentMessageId`).
   */
  mainMessageId?: string;
  messageId: string;
  /** Last known model carried from the prior turn (real model lands via usage). */
  model?: string;
  parentId: string;
  provider?: string;
  /** External-signal context to stamp on `metadata.signal` (Monitor pushes etc.). */
  signal?: ExternalSignalContext;
  topicId: string | null;
}

/**
 * Durable flush of an assistant's content/reasoning/model/provider/metadata.
 * Used for the prior-turn flush at a boundary, the `stream_start` init
 * model/provider backfill, and the terminal final flush.
 */
export interface PersistAssistantIntent {
  content?: string;
  kind: 'persistAssistant';
  messageId: string;
  metadata?: Record<string, any>;
  model?: string;
  provider?: string;
  reasoning?: string;
}

/** Live in-memory content update (replace). Renderer applies; server no-ops. */
export interface MainStreamContentIntent {
  content?: string;
  kind: 'streamContent';
  messageId: string;
  reasoning?: string;
}

/**
 * Persist a batch of main-agent tool calls into the current assistant. Same
 * 3-phase write as the subagent variant: (1) `assistant.tools[]` without
 * result_msg_id, (2) create rows for `isNew` entries with their pre-allocated
 * ids + populate the tool-message lookup, (3) re-write `assistant.tools[]` with
 * `result_msg_id` backfilled from each entry's `toolMessageId`.
 */
export interface MainPersistToolBatchIntent {
  assistantMessageId: string;
  content?: string;
  kind: 'persistToolBatch';
  reasoning?: string;
  tools: PersistToolBatchEntry[];
}

/**
 * Resolve a main-agent tool_result. The interpreter looks up the tool-message
 * id from its `toolCallId → messageId` map (the run-global one, DB-backed on
 * the server so a cross-replica result still lands).
 */
export interface MainResolveToolResultIntent {
  content: string;
  isError: boolean;
  kind: 'resolveToolResult';
  pluginState?: Record<string, any>;
  toolCallId: string;
}

/** Attach per-turn usage/model/provider to the current assistant. */
export interface MainRecordUsageIntent {
  kind: 'recordUsage';
  messageId: string;
  model?: string;
  provider?: string;
  usage: unknown;
}

/**
 * Stamp a terminal error on the current assistant. The reducer decides
 * `clearContent` (echo suppression) purely; the interpreter keeps ownership of
 * provider-specific error CLASSIFICATION — it receives the raw wire `errorData`
 * and runs its own classifier (`toHeterogeneousAgentMessageError` /
 * `toChatMessageError`).
 */
export interface SetErrorIntent {
  /** True when the streamed content echoed the error and should be cleared. */
  clearContent: boolean;
  /** Raw terminal error event data; interpreter classifies into ChatMessageError. */
  errorData: unknown;
  kind: 'setError';
  messageId: string;
}
