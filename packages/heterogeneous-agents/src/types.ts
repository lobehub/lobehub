/**
 * Heterogeneous Agent Adapter Types
 *
 * Adapters convert external agent protocol events into a unified
 * HeterogeneousAgentEvent format, which maps 1:1 to LobeHub's
 * AgentStreamEvent and can be fed directly into createGatewayEventHandler().
 *
 * Architecture:
 *   Claude Code stream-json ──→ ClaudeCodeAdapter ──→ HeterogeneousAgentEvent[]
 *   Codex CLI output         ──→ CodexAdapter      ──→ HeterogeneousAgentEvent[]  (future)
 *   ACP JSON-RPC             ──→ ACPAdapter        ──→ HeterogeneousAgentEvent[]  (future)
 */

// ─── Unified Event Format ───
// Mirrors AgentStreamEvent from src/libs/agent-stream/types.ts
// but defined here so the package is self-contained.

export type HeterogeneousEventType =
  | 'stream_start'
  | 'stream_chunk'
  | 'stream_end'
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

export type StreamChunkType = 'text' | 'reasoning' | 'tools_calling';

export interface HeterogeneousAgentEvent {
  data: any;
  stepIndex: number;
  timestamp: number;
  type: HeterogeneousEventType;
}

/** Data shape for stream_start events */
export interface StreamStartData {
  assistantMessage?: { id: string };
  model?: string;
  provider?: string;
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
  reasoning?: string;
  /**
   * Subagent context for the entire chunk — peer to `toolsCalling`,
   * `content`, and `reasoning`. Stream-state info (parent spawn id,
   * subagent turn id) belongs on the event, not inside the payloads.
   */
  subagent?: SubagentEventContext;
  toolsCalling?: ToolCallPayload[];
}

/** Data shape for tool_end events */
export interface ToolEndData {
  isSuccess: boolean;
  /** Subagent context if this tool_end belongs to a subagent inner tool. */
  subagent?: SubagentEventContext;
  toolCallId: string;
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

/**
 * Registry of built-in CLI flag presets per agent type.
 * The Electron controller uses this to construct the full spawn args.
 */
export interface AgentCLIPreset {
  /** Base CLI arguments (e.g., ['-p', '--output-format', 'stream-json', '--verbose']) */
  baseArgs: string[];
  /** How to pass the prompt (e.g., 'positional' = last arg, 'stdin' = pipe to stdin) */
  promptMode: 'positional' | 'stdin';
  /** How to resume a session (e.g., ['--resume', '{sessionId}']) */
  resumeArgs?: (sessionId: string) => string[];
}
