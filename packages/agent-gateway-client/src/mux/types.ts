import type {
  AgentStreamClientEvents,
  AgentStreamEvent,
  ConnectionStatus,
  SessionStatus,
  ToolResultMessage,
} from '../types';

// ─── Protocol v2: Client → Hub ───

export interface MuxSubscribeMessage {
  executor?: boolean;
  lastEventId?: string;
  operationId: string;
  type: 'subscribe';
}

export interface MuxUnsubscribeMessage {
  operationId: string;
  type: 'unsubscribe';
}

/** Auto-answered by the hub's WebSocket auto-response pair; never wakes the DO. */
export interface MuxHeartbeatMessage {
  type: 'heartbeat';
}

export interface MuxToolResultMessage extends Omit<ToolResultMessage, 'type'> {
  operationId: string;
  type: 'tool_result';
}

export interface MuxToolConfirmationMessage {
  approved: boolean;
  operationId: string;
  toolCallId: string;
  type: 'tool_confirmation';
}

export interface MuxUserInputMessage {
  content: string;
  operationId: string;
  requestId: string;
  type: 'user_input';
}

export interface MuxInterruptMessage {
  operationId: string;
  type: 'interrupt';
}

export type MuxClientMessage =
  | MuxHeartbeatMessage
  | MuxInterruptMessage
  | MuxSubscribeMessage
  | MuxToolConfirmationMessage
  | MuxToolResultMessage
  | MuxUnsubscribeMessage
  | MuxUserInputMessage;

// ─── Protocol v2: Hub → Client ───

export interface MuxReadyMessage {
  connectionId: string;
  protocol: 2;
  type: 'ready';
  userId: string;
}

export interface MuxAgentEventMessage {
  /** `event.operationId` may differ from `operationId` (mirrored member event). */
  event: AgentStreamEvent;
  id: string;
  operationId: string;
  type: 'agent_event';
}

export interface MuxSessionCompleteMessage {
  id: string;
  operationId: string;
  summary?: unknown;
  type: 'session_complete';
}

export interface MuxStatusChangeMessage {
  id: string;
  operationId: string;
  status: SessionStatus;
  type: 'status_change';
}

export interface MuxToolConfirmationRequestMessage {
  id: string;
  operationId: string;
  tool: unknown;
  toolCallId: string;
  type: 'tool_confirmation_request';
}

export interface MuxInputRequestMessage {
  id: string;
  operationId: string;
  prompt: unknown;
  requestId: string;
  type: 'input_request';
}

export interface MuxResumeCompleteMessage {
  gap: boolean;
  operationId: string;
  /** The op DO has not received `init` yet; the hub will replay once it does. */
  pending?: boolean;
  status?: SessionStatus;
  type: 'resume_complete';
}

export interface MuxSubscribeFailedMessage {
  operationId: string;
  reason: 'forbidden' | 'invalid';
  type: 'subscribe_failed';
}

export interface MuxOperationMeta {
  agentId?: string;
  groupId?: string;
  mirrorToOperationId?: string;
  parentOperationId?: string;
  rootOperationId?: string;
  scope?: string;
  taskId?: string;
  threadId?: string;
  topicId?: string;
}

export interface MuxOpLifecycleMessage {
  at: number;
  meta?: MuxOperationMeta;
  operationId: string;
  status: SessionStatus | 'gone';
  summary?: unknown;
  type: 'op_lifecycle';
}

export interface MuxHeartbeatAckMessage {
  type: 'heartbeat_ack';
}

export interface MuxErrorMessage {
  code: string;
  message: string;
  operationId?: string;
  type: 'error';
}

export type MuxServerMessage =
  | MuxAgentEventMessage
  | MuxErrorMessage
  | MuxHeartbeatAckMessage
  | MuxInputRequestMessage
  | MuxOpLifecycleMessage
  | MuxReadyMessage
  | MuxResumeCompleteMessage
  | MuxSessionCompleteMessage
  | MuxStatusChangeMessage
  | MuxSubscribeFailedMessage
  | MuxToolConfirmationRequestMessage;

/** Hub → client messages that are addressed to one operation subscription. */
export type MuxOperationMessage =
  | Exclude<Extract<MuxServerMessage, { operationId: string }>, MuxOpLifecycleMessage>
  | (MuxErrorMessage & { operationId: string });

// ─── Client options ───

export interface GatewayMuxClientOptions {
  /** Auto-reconnect with per-op lastEventId resubscribe (default: true) */
  autoReconnect?: boolean;
  /** Stable id for this tab; the hub tags the connection with it. Random when omitted. */
  clientId?: string;
  /** Gateway URL base (e.g. https://gateway.lobehub.com); the client appends `/v2/ws`. */
  gatewayUrl: string;
  /** Called before EVERY connect attempt; must return a fresh user JWT. */
  getToken: () => Promise<string>;
  /** Heartbeat period in ms (default: 30_000). Sends exactly `{"type":"heartbeat"}`. */
  heartbeatIntervalMs?: number;
  /**
   * Keep the socket up even while nothing is subscribed (default: false).
   * Off: the socket is closed once the last subscription ends and a lost idle
   * socket is not redialed (the next `subscribe` dials again). On: a page-wide
   * mux dialed on app entry stays up and is redialed on `online` / tab-visible
   * even with nothing subscribed.
   */
  keepAlive?: boolean;
}

export type GatewayMuxStatus = 'connected' | 'connecting' | 'disconnected';

export interface GatewayMuxClientEvents {
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
  lifecycle: (lifecycle: MuxOpLifecycleMessage) => void;
  reconnecting: (delay: number) => void;
  status_changed: (status: GatewayMuxStatus) => void;
}

// ─── Operation subscription ───

export type ToolResultPayload = Omit<ToolResultMessage, 'type'>;

export interface ResumeCompleteInfo {
  gap: boolean;
  pending?: boolean;
  status?: SessionStatus;
}

export interface OperationSubscribeOptions {
  /** Run local `tool_execute` requests on this tab (the tab that started the run). */
  executor?: boolean;
  /** Last event id already applied; the hub replays only newer events. */
  lastEventId?: string;
}

/**
 * Per-operation events. A superset of the v1 `AgentStreamClientEvents` so a
 * subscription can stand in for an `AgentStreamClient` in the store.
 */
export interface OperationSubscriptionEvents extends AgentStreamClientEvents {
  input_request: (request: MuxInputRequestMessage) => void;
  resume_complete: (info: ResumeCompleteInfo) => void;
  status_change: (status: SessionStatus) => void;
  tool_confirmation_request: (request: MuxToolConfirmationRequestMessage) => void;
}

export interface OperationSubscription {
  /** True until `unsubscribe()` or a terminal signal ends this subscription. */
  readonly active: boolean;
  /** Highest event id applied so far (empty string before any event). */
  readonly lastEventId: string;
  on: <K extends keyof OperationSubscriptionEvents>(
    event: K,
    listener: OperationSubscriptionEvents[K],
  ) => () => void;
  operationId: string;
  sendInterrupt: () => boolean;
  sendToolConfirmation: (toolCallId: string, approved: boolean) => boolean;
  /** Queued while the socket is down (TTL 120s) and flushed after resubscribe. */
  sendToolResult: (result: ToolResultPayload) => boolean;
  sendUserInput: (requestId: string, content: string) => boolean;
  /** Connection state as seen by this operation (v1 `connectionStatus` parity). */
  readonly status: ConnectionStatus;
  unsubscribe: () => void;
}
