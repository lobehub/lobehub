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

/** Data shape for stream_chunk events */
export interface StreamChunkData {
  chunkType: StreamChunkType;
  content?: string;
  reasoning?: string;
  toolsCalling?: ToolCallPayload[];
}

/** Data shape for tool_end events */
export interface ToolEndData {
  isSuccess: boolean;
  toolCallId: string;
}

/** Data shape for tool_result events (ACP-specific) */
export interface ToolResultData {
  content: string;
  isError?: boolean;
  toolCallId: string;
}

/** Tool call payload (matches ChatToolPayload shape) */
export interface ToolCallPayload {
  apiName: string;
  arguments: string;
  id: string;
  identifier: string;
  type: string;
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
