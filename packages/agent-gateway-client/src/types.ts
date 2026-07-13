// ─── Agent Stream Event (mirrors server StreamEvent) ───

export type AgentStreamEventType =
  | 'agent_runtime_init'
  | 'agent_runtime_end'
  | 'stream_start'
  | 'stream_chunk'
  | 'stream_end'
  /**
   * Producer-side boundary meaning this operation will not emit more visible
   * assistant/tool/intervention output. The operation may still wait for
   * `agent_runtime_end` to finish terminal bookkeeping.
   */
  | 'visible_output_end'
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
  /**
   * Lightweight invalidation signal emitted by `agentNotify.notify` when a
   * remote hetero agent (openclaw / hermes) writes a message to DB via
   * `lh notify`. The frontend reacts by calling `fetchAndReplaceMessages` —
   * no content is carried in the event itself (DB is the source of truth).
   */
  | 'notify_update'
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

/**
 * The assistant message row the server created for this step.
 *
 * `id` is always present. Newer servers also ship the seed fields the client
 * needs to insert the message into its local store: the `step_start`
 * uiMessages snapshot is resolved BEFORE this row is created, so the snapshot
 * never contains it — without a local insert, every stream_chunk/stream_end
 * dispatch for the step targets a missing id and is silently dropped
 * (LOBE-11501). Older servers send only `{ id }`; clients fall back to a DB
 * refetch in that case.
 */
export interface StreamStartAssistantMessage {
  agentId?: string | null;
  groupId?: string | null;
  id: string;
  model?: string | null;
  parentId?: string | null;
  provider?: string | null;
  role?: string;
  threadId?: string | null;
  topicId?: string | null;
}

export interface StreamStartData {
  assistantMessage: StreamStartAssistantMessage;
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
 * `step_complete` carrying `phase: 'subagent_progress'` — a `callSubAgent`
 * child's running totals, emitted once per child step.
 *
 * Published onto the PARENT operation's channel, because the client opens one
 * WebSocket per operation and never subscribes to the child's. Rides
 * `step_complete` rather than a new `AgentStreamEventType` so the out-of-repo
 * gateway worker needs no change, and so older clients (which only act on
 * `phase: 'execution_complete'`) ignore it.
 *
 * Advisory only — the authoritative stats are backfilled onto the tool
 * message's `pluginState` by `completeSubAgentBridge` when the child finishes.
 */
export interface SubAgentProgressData extends StepCompleteData {
  model?: string;
  phase: 'subagent_progress';
  /** The parked parent's placeholder tool message these stats belong to. */
  toolMessageId: string;
  totalCost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
  totalToolCalls?: number;
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
  /** Agent currently running the tool. */
  agentId?: string | null;
  /** Tool function name (e.g. "readFile"). */
  apiName: string;
  /** JSON-encoded argument string as returned by the LLM. */
  arguments: string;
  /** Assistant message that carries this tool call. */
  assistantMessageId?: string;
  /** Current page document ID for page-scoped conversations. */
  documentId?: string | null;
  /** Per-invocation deadline. Server caps against its own function budget. */
  executionTimeoutMs: number;
  /** Group chat ID, when the run belongs to a group conversation. */
  groupId?: string | null;
  /** Tool plugin identifier (e.g. "local-system"). */
  identifier: string;
  /** Root server-side runtime operation ID for this assistant run. */
  rootOperationId?: string;
  /** Conversation scope captured by the server runtime. */
  scope?: string | null;
  /** Source user message ID for tools that need the current turn. */
  sourceMessageId?: string | null;
  /** Current task identifier or database id when task-scoped. */
  taskId?: string | null;
  /** Current thread ID when thread-scoped. */
  threadId?: string | null;
  /** Unique tool call id; used as the correlation key for the returned result. */
  toolCallId: string;
  /** Tool result message id, when the server created it before dispatch. */
  toolMessageId?: string;
  /** Current topic ID. */
  topicId?: string | null;
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
  /**
   * Opt into the authoritative `resume_complete` reply. Set by
   * this client so a current gateway hands back the stored session status;
   * legacy gateways ignore it and replay only.
   */
  wantStatus?: boolean;
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
  /**
   * In-memory relay of the client-side Work registration intent (a
   * `WorkRegistrationIntent`, kept opaque here to preserve this package's
   * zero-`@lobechat` dependency surface — mirrors how `state` is typed). The
   * server registers the Work version from it and NEVER persists it with the
   * tool message.
   */
  workRegistration?: any;
}

export type ClientMessage =
  AuthMessage | HeartbeatMessage | InterruptMessage | ResumeMessage | ToolResultMessage;

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

/**
 * Authoritative session status. Mirrors the gateway DO's `SessionStatus`.
 */
export type SessionStatus =
  'running' | 'waiting_input' | 'waiting_confirmation' | 'completed' | 'error' | 'interrupted';

/**
 * Server → Client: sent right after a `resume` replay, carrying the DO's
 * authoritative `status` from storage. Because the DO's in-memory event buffer
 * is wiped by hibernation, an empty replay is ambiguous — the run may still be
 * alive. This message resolves that ambiguity so the client never guesses
 * "completed" from silence (which would clear the shared `runningOperation` and
 * cancel the run on every device).
 */
export interface ResumeCompleteMessage {
  status: SessionStatus;
  type: 'resume_complete';
}

export type ServerMessage =
  | AgentEventMessage
  | AuthExpiredMessage
  | AuthFailedMessage
  | AuthSuccessMessage
  | HeartbeatAckMessage
  | ResumeCompleteMessage
  | SessionCompleteMessage;

// ─── Connection Status ───

export type ConnectionStatus =
  'authenticating' | 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

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
