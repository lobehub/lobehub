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
