/**
 * Heterogeneous Agent Adapter Types
 *
 * Adapters convert external agent protocol events into a unified
 * HeterogeneousAgentEvent format, which maps 1:1 to LobeHub's
 * AgentStreamEvent and can be fed directly into createGatewayEventHandler().
 *
 * Architecture:
 *   Claude Code stream-json ──→ ClaudeCodeAdapter ──→ HeterogeneousAgentEvent[]
 *   Codex CLI output         ──→ CodexAdapter      ──→ HeterogeneousAgentEvent[]
 *   OpenCode JSONL           ──→ OpenCodeAdapter   ──→ HeterogeneousAgentEvent[]
 *   ACP JSON-RPC             ──→ ACPAdapter        ──→ HeterogeneousAgentEvent[]  (future)
 */

// ─── Unified Event Format ───
// Mirrors AgentStreamEvent from src/libs/agent-stream/types.ts
// but defined here so the package is self-contained.

export type HeterogeneousEventType =
  | 'stream_start'
  | 'stream_chunk'
  | 'stream_end'
  /**
   * Producer is retrying the upstream model request after a transient failure.
   * Mirrors the server/gateway `stream_retry` event so renderer-side running
   * operation metadata can surface the otherwise silent wait.
   */
  | 'stream_retry'
  /**
   * Producer-side boundary meaning this operation will not emit more visible
   * assistant/tool output. The operation may still wait for `agent_runtime_end`
   * to finish terminal bookkeeping.
   */
  | 'visible_output_end'
  | 'tool_start'
  | 'tool_end'
  /**
   * Tool result content arrived. ACP-specific (Gateway tools run on server,
   * so server handles result persistence). Executor should update the tool
   * message in DB with this content.
   */
  | 'tool_result'
  | 'step_complete'
  | 'agent_runtime_end'
  | 'error';

export type StreamChunkType = 'text' | 'reasoning' | 'tool_state' | 'tools_calling';

export interface HeterogeneousAgentEvent {
  data: any;
  stepIndex: number;
  timestamp: number;
  type: HeterogeneousEventType;
}

/** Data shape for stream_start events */
export interface StreamStartData {
  assistantMessage?: { id: string };
  /**
   * External-trigger context for the step opened by this stream_start.
   * Set when the new step was opened in response to a repeated tool
   * result on the same `tool_use.id` (Monitor stdout push pattern) or
   * other out-of-band callback — i.e. NOT a fresh user message.
   *
   * Executor stamps this onto the new assistant message's
   * `metadata.signal` so MessageCollector can collect signal-tagged
   * toolless assistants into a SignalCallbacksNode.
   *
   * Phase 2 () promotes the persisted shape to a dedicated
   * `messages.signal` column; the event peer field name stays
   * `externalSignal` regardless.
   */
  externalSignal?: ExternalSignalContext;
  model?: string;
  provider?: string;
  /**
   * CC-native session id (`system:init.session_id`), carried on every
   * stream_start so the server can stamp it on each persisted message's
   * `metadata.heteroSessionId`. The topic-level `heteroSessionId` only keeps
   * the single latest value; a per-message copy lets a diff pinpoint the exact
   * row where CC forked to a new session (e.g. `--resume` hit a recycled /
   * empty session and started fresh) — the forensic signal for a lost-history
   * "session break".
   */
  sessionId?: string;
}

/**
 * Carried as a peer field on stream events when the LLM turn was
 * triggered by an external signal rather than a fresh user message.
 *
 * Canonical case: CC's Monitor tool keeps pushing additional stdout
 * lines as `tool_result` blocks on the SAME `tool_use.id`, each push
 * driving a new assistant turn. Future variants will cover webhook
 * callbacks, scheduled triggers, and agent-signal sources.
 *
 * The adapter detects these patterns by counting tool_results per
 * `tool_use.id`; the executor writes the context to
 * `message.metadata.signal`; the conversation-flow collector groups
 * signal-tagged toolless assistants into a SignalCallbacksNode.
 */
export interface ExternalSignalContext {
  /** Nth push from the same source (1 = first repeat result). */
  sequence?: number;
  /** Source `tool_use.id` (CC) / function call id whose repeat fired this signal. */
  sourceToolCallId: string;
  /** Tool name for UI labelling, e.g. `Monitor`. */
  sourceToolName: string;
  /**
   * Discriminator for the trigger source — wire-stable.
   *
   * - `tool-stdout`: Monitor / long-running-tool stdout push pattern —
   *   each turn is a reactive reply to a stdout event.
   * - `tool-callback`: (future) one-shot async callback variant.
   * - `task-completion`: the post-task summary turn — fired by the LLM
   *   after CC delivers `system task_notification` (and the implicit
   *   "task ended" user event). Carries the same `sourceTool*` lineage
   *   as the preceding callbacks so the renderer can keep the summary
   *   inside the same AssistantGroup (appended after the SignalCallbacks
   *   block), instead of letting it spawn a separate group.
   *
   * Future webhook / scheduled / agent-signal-source variants land
   * here as the pipeline absorbs more upstreams.
   */
  type: 'tool-stdout' | 'tool-callback' | 'task-completion';
}

/**
 * Adapter-extracted spawn metadata, attached to the FIRST event the
 * adapter emits for a new subagent run (keyed by `parentToolCallId`).
 * Lets the executor lazy-create the subagent Thread on first sight
 * without needing to know about adapter-specific tool names (CC `Task`,
 * Codex subtask, ...) or parse `tool_use.input`.
 *
 * Absent on subsequent events for the same parent.
 */
export interface SubagentSpawnMetadata {
  /** Short label / title for the spawn (CC Task's `description`). */
  description?: string;
  /**
   * Initial user-message content for the subagent Thread (CC Task's
   * `prompt`). The executor writes this as the Thread's `role:'user'`
   * message so the subagent's conversation is reconstructable as a
   * standalone chat.
   */
  prompt?: string;
  /** Subagent template label (CC Task's `subagent_type`). */
  subagentType?: string;
}

/**
 * Subagent-origination context, carried as a peer field on event `data`
 * (NOT on `ToolCallPayload`). A stream event originating from a subagent
 * turn — CC `Task` spawn, Codex subtask, ... — stamps this on the chunk
 * so the executor can route the batch of tools / the tool_result into the
 * right Thread + subagent assistant message. Per-event scope: all tools
 * in the same chunk share the same parent / turn ids, so the info
 * describes the containing chunk, not individual payloads.
 *
 * Main-agent events leave `subagent` undefined.
 */
export interface SubagentEventContext {
  /**
   * The main-agent tool_use id that spawned this subagent (CC Task's
   * tool_use.id). Persistent across the entire subagent run; used by the
   * executor to look up the Thread for this spawn.
   */
  parentToolCallId: string;
  /**
   * Spawn metadata — present only on the FIRST event the adapter emits
   * for a given `parentToolCallId`, absent on subsequent events. The
   * executor uses this to create the subagent Thread + seed its
   * `role:'user'` message the moment it first sees subagent activity,
   * without re-parsing the Task tool_use input or knowing CC-specific
   * argument shapes.
   */
  spawnMetadata?: SubagentSpawnMetadata;
  /**
   * The subagent CLI's message.id for THIS turn. Set on `tools_calling`
   * / `tool_start` chunks where the executor needs to detect turn
   * boundaries (change triggers a new assistant message inside the
   * Thread). Omitted on `tool_result` / `tool_end` where the turn is
   * already established by the corresponding tool_use.
   */
  subagentMessageId?: string;
}

/** Data shape for stream_chunk events */
export interface StreamChunkData {
  chunkType: StreamChunkType;
  content?: string;
  pluginState?: Record<string, unknown>;
  reasoning?: string;
  snapshotMode?: 'replace';
  snapshotSeq?: number;
  /**
   * Subagent context for the entire chunk — peer to `toolsCalling`,
   * `content`, and `reasoning`. Stream-state info (parent spawn id,
   * subagent turn id) belongs on the event, not inside the payloads.
   */
  subagent?: SubagentEventContext;
  toolCallId?: string;
  toolsCalling?: ToolCallPayload[];
}

/**
 * Non-terminal, replace-only snapshot for a running tool message.
 *
 * `snapshotSeq` is monotonic within `(operationId, toolCallId)`; operationId
 * lives on the enclosing wire event. The final `tool_result` remains the
 * authoritative terminal snapshot and does not consume this sequence.
 */
export interface ToolStateChunkData {
  chunkType: 'tool_state';
  pluginState: Record<string, unknown>;
  snapshotMode: 'replace';
  snapshotSeq: number;
  subagent?: SubagentEventContext;
  toolCallId: string;
}

/** Data shape for tool_end events */
export interface ToolEndData {
  isSuccess: boolean;
  /** Subagent context if this tool_end belongs to a subagent inner tool. */
  subagent?: SubagentEventContext;
  toolCallId: string;
}

/**
 * A single image echoed by a heterogeneous tool_result — e.g. CC's `Read` on
 * an image file, which returns an `image` content block instead of text.
 *
 * The adapter synthesizes these onto `pluginState.images` carrying the raw
 * base64 `data` (it can only see the CLI payload, not the file store). The
 * runtime-side {@link AgentStreamPipeline} then uploads each one and rewrites
 * the entry into a `{ fileId, url }` reference, dropping `data` so the heavy
 * base64 never reaches the persistence sinks / DB. If upload is unavailable or
 * fails, the entry is dropped and the human-readable `[Image: …]` placeholder
 * left in `content` is the fallback.
 */
export interface HeterogeneousToolResultImage {
  /** Base64 payload — present pre-upload; stripped once `fileId`/`url` are set. */
  data?: string;
  /** File record id after upload to the file store. */
  fileId?: string;
  /** IANA media type, e.g. `image/png`. */
  mediaType: string;
  /** Remote URL after upload. */
  url?: string;
}

/** Data shape for tool_result events (ACP-specific) */
export interface ToolResultData {
  content: string;
  isError?: boolean;
  /**
   * Normalized result-domain state for this tool call. Adapters may synthesize
   * this for tools whose tool_use input *is* the target state (e.g. CC's
   * TodoWrite) so consumers can render derived UI from a single message shape,
   * without each consumer re-parsing tool args.
   *
   * Image-returning tools (CC `Read`) synthesize `pluginState.images` as
   * {@link HeterogeneousToolResultImage}[] — see that type for the base64 →
   * uploaded-reference lifecycle.
   */
  pluginState?: Record<string, any>;
  /** Subagent context if this tool_result belongs to a subagent inner tool. */
  subagent?: SubagentEventContext;
  toolCallId: string;
}

/**
 * Tool call payload (matches ChatToolPayload shape).
 *
 * Kept minimal and stream/persistence-agnostic: no subagent lineage,
 * no turn ids, no spawn markers. Those live on the containing event's
 * `subagent` peer field ({@link SubagentEventContext}) because they
 * describe the chunk's origin, not the tool call itself.
 */
export interface ToolCallPayload {
  apiName: string;
  arguments: string;
  id: string;
  identifier: string;
  type: string;
}

/**
 * Normalized token usage for a single LLM call. Field names mirror LobeHub's
 * `MessageMetadata.usage` so the executor can write this shape straight to
 * `metadata.usage` with no further conversion.
 *
 * Each adapter is responsible for mapping its provider-native usage object
 * (Anthropic `input_tokens` + cache split, OpenAI `prompt_tokens`, etc.) into
 * this shape. Provider-specific shape knowledge does not leak past the adapter.
 */
export interface UsageData {
  /** Input tokens served from the prompt cache (cache reads). */
  inputCachedTokens?: number;
  /** Input tokens that missed the prompt cache (fresh prompt bytes). */
  inputCacheMissTokens: number;
  /** Input tokens written into the prompt cache (cache creation). */
  inputWriteCacheTokens?: number;
  /** Output tokens used for model reasoning. */
  outputReasoningTokens?: number;
  /** Non-reasoning output tokens. */
  outputTextTokens?: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

/**
 * Data shape for `step_complete` events. `phase` disambiguates the subtype:
 *   - `turn_metadata`: per-turn snapshot of model + provider + usage (once per LLM call)
 *   - `result_usage`: authoritative grand total at the end of a session
 */
export interface StepCompleteData {
  /** Total session cost in USD (only on `result_usage`, if the CLI reports it). */
  costUsd?: number;
  /** Model id for this turn (only meaningful on `turn_metadata`). */
  model?: string;
  phase: 'turn_metadata' | 'result_usage';
  /**
   * Provider identifier for this turn — the CLI / adapter name (e.g.
   * `claude-code`, `codex`), not the underlying LLM vendor. CLI-wrapped agents
   * bill via their own subscription so downstream pricing logic keys on the
   * CLI provider, not on the wrapped model's native vendor.
   */
  provider?: string;
  usage?: UsageData;
}

export interface HeterogeneousRateLimitInfo {
  isUsingOverage?: boolean;
  overageDisabledReason?: string;
  overageStatus?: string;
  rateLimitType?: string;
  resetsAt?: number;
  status?: string;
}

/**
 * Normalized terminal error payload emitted by adapters when the upstream CLI
 * exposes enough context to classify the failure. The executor can persist
 * this directly as a `ChatMessageError` body without re-parsing provider-
 * specific stderr shapes.
 */
export interface HeterogeneousTerminalErrorData {
  agentType?: string;
  clearEchoedContent?: boolean;
  code?: string;
  /**
   * Diagnostic context from the CLI's terminal event (subtype, HTTP status,
   * turn count, session id, …). Persisted verbatim into the error body so the
   * error card's details pane explains the failure even when the CLI reported
   * no message text.
   */
  details?: Record<string, unknown>;
  docsUrl?: string;
  error?: string;
  installCommands?: readonly string[];
  message: string;
  rateLimitInfo?: HeterogeneousRateLimitInfo;
  stderr?: string;
}

// ─── Adapter Interface ───

/**
 * Stateful adapter that converts raw agent events to HeterogeneousAgentEvent[].
 *
 * Adapters maintain internal state (e.g., pending tool calls) to correctly
 * emit lifecycle events like tool_start / tool_end.
 */
export interface AgentEventAdapter {
  /**
   * Convert a single raw event into zero or more HeterogeneousAgentEvents.
   */
  adapt: (raw: any) => HeterogeneousAgentEvent[];

  /**
   * Flush any buffered events (call at end of stream).
   */
  flush: () => HeterogeneousAgentEvent[];

  /** The session ID extracted from the agent's init event (for multi-turn resume). */
  sessionId?: string;
}

// ─── Agent Process Config ───

/**
 * Configuration for spawning an external agent CLI process.
 * Agent-agnostic — works for claude, codex, kimi-cli, etc.
 */
export interface AgentProcessConfig {
  /** Adapter type key (e.g., 'claude-code', 'codex', 'kimi-cli') */
  adapterType: string;
  /** CLI arguments appended after built-in flags */
  args?: string[];
  /** Command to execute (e.g., 'claude', 'codex') */
  command: string;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
}
