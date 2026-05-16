// ─── Agent Stream Event (mirrors server StreamEvent) ───

export type AgentStreamEventType =
  | 'agent_runtime_init'
  | 'agent_runtime_end'
  | 'stream_start'
  | 'stream_chunk'
  | 'stream_end'
  | 'stream_retry'
  | 'tool_start'
  | 'tool_end'
  | 'tool_execute'
  /**
   * Producer-side tool result content (heterogeneous CLI agents emit this
   * separately from `tool_end`; gateway-driven runs do not). Kept in the
   * wire union so consumers can pattern-match without casting.
   */
  | 'tool_result'
  /**
   * Producer needs structured input from the user mid-run (e.g. CC's
   * AskUserQuestion delivered via a local MCP server). Distinct from
   * `tool_execute` — that one means "client, please run this tool"; this
   * one means "user, please answer these questions". Renderer surfaces a
   * dedicated UI; the producer's MCP handler stays pending until the
   * paired `agent_intervention_response` resolves it (or the deadline
   * passes / the op is cancelled).
   */
  | 'agent_intervention_request'
  /**
   * The user's answer to a prior `agent_intervention_request`. Flows back
   * to the producer (Electron main → MCP handler resolve, sandbox →
   * server bus → CLI). Carries either a structured `result` or a
   * cancellation marker.
   */
  | 'agent_intervention_response'
  | 'step_start'
  | 'step_complete'
  | 'error';

export interface AgentStreamEvent {
  data: any;
  id?: string;
  operationId: string;
  stepIndex: number;
  timestamp: number;
  type: AgentStreamEventType;
}

export type StreamChunkType =
  | 'text'
  | 'reasoning'
  | 'tools_calling'
  | 'image'
  | 'grounding'
  | 'base64_image'
  | 'content_part'
  | 'reasoning_part';

export interface StreamChunkData {
  chunkType: StreamChunkType;
  content?: string;
  contentParts?: Array<{ text: string; type: 'text' } | { image: string; type: 'image' }>;
  grounding?: any;
  imageList?: any[];
  images?: any[];
  reasoning?: string;
  reasoningParts?: Array<{ text: string; type: 'text' } | { image: string; type: 'image' }>;
  toolsCalling?: any[];
}

// ─── Typed Event Data ───

export interface StreamStartData {
  assistantMessage: { id: string };
  model?: string;
  provider?: string;
}

export interface ToolStartData {
  parentMessageId: string;
  toolCalling: Record<string, unknown>;
}

export interface ToolEndData {
  executionTime?: number;
  isSuccess: boolean;
  payload?: Record<string, unknown>;
  result?: unknown;
}

export interface StepCompleteData {
  finalState?: unknown;
  phase: string;
  reason?: string;
  reasonDetail?: string;
}

/**
 * Producer → consumer: structured-input request the user must answer
 * directly (no tool execution involved). The producer's tool handler stays
 * blocked until a matching `agent_intervention_response` (correlated by
 * `toolCallId`) flows back, or the `deadline` is reached.
 */
export interface AgentInterventionRequestData {
  /** Tool API name (e.g. `'askUserQuestion'`). */
  apiName: string;
  /** JSON-encoded payload the UI renders (e.g. `{ questions: [...] }`). */
  arguments: string;
  /** Unix-ms wall-clock at which the producer will give up waiting. */
  deadline: number;
  /** Tool plugin identifier (e.g. `'claude-code'`). */
  identifier: string;
  /** Correlation key. Stable for the lifetime of the intervention. */
  toolCallId: string;
}

/**
 * Consumer → producer: the user's answer to a prior intervention request.
 * Either `result` (success) or `cancelled: true` (timeout / user cancel).
 */
export interface AgentInterventionResponseData {
  /** Set when the user cancelled or the deadline elapsed. */
  cancelled?: boolean;
  /** When `cancelled`, optional reason for telemetry/logging. */
  cancelReason?: 'timeout' | 'user_cancelled' | 'session_ended';
  /** User-supplied answer (JSON-serializable). Absent when cancelled. */
  result?: unknown;
  toolCallId: string;
}

/**
 * Server → Client: request the client to execute a tool locally and return the result.
 */
export interface ToolExecuteData {
  /** Tool function name (e.g. "readFile"). */
  apiName: string;
  /** JSON-encoded argument string as returned by the LLM. */
  arguments: string;
  /** Per-invocation deadline. Server caps against its own function budget. */
  executionTimeoutMs: number;
  /** Tool plugin identifier (e.g. "local-system"). */
  identifier: string;
  /** Unique tool call id; used as the correlation key for the returned result. */
  toolCallId: string;
}

// ─── WebSocket Protocol Messages ───

// Client → Server
export interface AuthMessage {
  token: string;
  type: 'auth';
}

export interface ResumeMessage {
  lastEventId: string;
  type: 'resume';
}

export interface HeartbeatMessage {
  type: 'heartbeat';
}

export interface InterruptMessage {
  type: 'interrupt';
}

/**
 * Client → Server: tool execution result, correlated by toolCallId.
 */
export interface ToolResultMessage {
  content: string | null;
  error?: {
    message: string;
    type?: string;
  };
  state?: any;
  success: boolean;
  toolCallId: string;
  type: 'tool_result';
}

export type ClientMessage =
  | AuthMessage
  | HeartbeatMessage
  | InterruptMessage
  | ResumeMessage
  | ToolResultMessage;

// Server → Client
export interface AuthSuccessMessage {
  type: 'auth_success';
}

export interface AuthFailedMessage {
  reason: string;
  type: 'auth_failed';
}

/**
 * Server → Client: token expired (e.g. JWT past `exp`) but the operation is
 * still alive on the server. The server keeps the WebSocket open so the
 * client can refresh its token and re-send `auth` without rebuilding the
 * connection. Treat this as recoverable, NOT terminal — `auth_failed` remains
 * the terminal "this op no longer exists / token is bogus" signal.
 */
export interface AuthExpiredMessage {
  type: 'auth_expired';
}

export interface AgentEventMessage {
  event: AgentStreamEvent;
  id?: string;
  type: 'agent_event';
}

export interface HeartbeatAckMessage {
  type: 'heartbeat_ack';
}

export interface SessionCompleteMessage {
  type: 'session_complete';
}

export type ServerMessage =
  | AgentEventMessage
  | AuthExpiredMessage
  | AuthFailedMessage
  | AuthSuccessMessage
  | HeartbeatAckMessage
  | SessionCompleteMessage;

// ─── Connection Status ───

export type ConnectionStatus =
  | 'authenticating'
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'reconnecting';

// ─── Client Events ───

export interface AgentStreamClientEvents {
  agent_event: (event: AgentStreamEvent) => void;
  /**
   * JWT expired but the server kept the socket open. Listener should refresh
   * the token, call `updateToken()`, then `reconnect()`. Until that happens
   * the socket is connected but unauthenticated — no events will arrive.
   */
  auth_expired: () => void;
  auth_failed: (reason: string) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
  reconnecting: (delay: number) => void;
  session_complete: () => void;
  status_changed: (status: ConnectionStatus) => void;
}

// ─── Client Options ───

export interface AgentStreamClientOptions {
  /** Auto-reconnect with lastEventId resume (default: true) */
  autoReconnect?: boolean;
  /** Gateway WebSocket URL base (e.g. https://gateway.lobehub.com) */
  gatewayUrl: string;
  /** Operation ID to subscribe to */
  operationId: string;
  /**
   * Enable resume buffering on first connect (default: false).
   * When true, events are buffered and deduplicated after the resume replay
   * completes, preventing out-of-order display during page-reload reconnect.
   * Only set this for reconnection scenarios, not for new operations.
   */
  resumeOnConnect?: boolean;
  /** Auth token */
  token: string;
}
