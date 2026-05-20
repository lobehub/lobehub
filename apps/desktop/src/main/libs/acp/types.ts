/**
 * ACP (Agent Client Protocol) type definitions
 * Based on: https://agentclientprotocol.com/protocol/schema
 */

// ============================================================
// JSON-RPC 2.0 base types
// ============================================================

export interface JsonRpcRequest {
  id: number | string;
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown> | object;
}

export interface JsonRpcResponse {
  error?: JsonRpcError;
  id: number | string | null;
  jsonrpc: '2.0';
  result?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  data?: unknown;
  message: string;
}

// ============================================================
// ACP Capabilities
// ============================================================

export interface ACPCapabilities {
  audio?: boolean;
  embeddedContext?: boolean;
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
  };
  image?: boolean;
  terminal?: boolean;
}

export interface ACPServerCapabilities {
  modes?: ACPMode[];
  name: string;
  protocolVersion: string;
  version?: string;
}

export interface ACPMode {
  description?: string;
  id: string;
  name: string;
}

// ============================================================
// Session types
// ============================================================

export interface ACPSessionInfo {
  createdAt?: string;
  id: string;
  title?: string;
}

// ============================================================
// Content block types (used in session/update)
// ============================================================

export type ACPContentBlock =
  | ACPTextContent
  | ACPImageContent
  | ACPAudioContent
  | ACPResourceContent
  | ACPResourceLinkContent;

export interface ACPTextContent {
  annotations?: Record<string, unknown>;
  text: string;
  type: 'text';
}

export interface ACPImageContent {
  annotations?: Record<string, unknown>;
  data: string;
  mimeType: string;
  type: 'image';
  uri?: string;
}

export interface ACPAudioContent {
  annotations?: Record<string, unknown>;
  data: string;
  mimeType: string;
  type: 'audio';
}

export interface ACPResourceContent {
  annotations?: Record<string, unknown>;
  resource: {
    blob?: string;
    mimeType?: string;
    text?: string;
    uri: string;
  };
  type: 'resource';
}

export interface ACPResourceLinkContent {
  annotations?: Record<string, unknown>;
  description?: string;
  mimeType?: string;
  name: string;
  size?: number;
  title?: string;
  type: 'resource_link';
  uri: string;
}

// ============================================================
// Tool call types
// ============================================================

export type ACPToolCallKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'other';

export type ACPToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ACPToolCallDiffContent {
  newText: string;
  oldText: string;
  path: string;
  type: 'diff';
}

export interface ACPToolCallTerminalContent {
  command?: string;
  exitCode?: number;
  output: string;
  type: 'terminal';
}

export type ACPToolCallContent =
  | ACPTextContent
  | ACPImageContent
  | ACPToolCallDiffContent
  | ACPToolCallTerminalContent;

export interface ACPToolCallLocation {
  endLine?: number;
  path: string;
  startLine?: number;
}

export interface ACPToolCallUpdate {
  content?: ACPToolCallContent[];
  kind?: ACPToolCallKind;
  locations?: ACPToolCallLocation[];
  rawInput?: string;
  rawOutput?: string;
  status?: ACPToolCallStatus;
  title: string;
  toolCallId: string;
}

// ============================================================
// Session update notification
// ============================================================

export type ACPMessageRole = 'assistant' | 'user' | 'thought';

export interface ACPMessageChunk {
  content: ACPContentBlock[];
  role: ACPMessageRole;
}

export interface ACPSessionUpdate {
  messageChunks?: ACPMessageChunk[];
  sessionId: string;
  toolCalls?: ACPToolCallUpdate[];
}

// ============================================================
// Permission request types
// ============================================================

export interface ACPPermissionOption {
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  name: string;
  optionId: string;
}

export interface ACPPermissionRequest {
  message?: string;
  options: ACPPermissionOption[];
  sessionId: string;
  toolCall?: ACPToolCallUpdate;
}

export interface ACPPermissionResponse {
  kind: 'selected' | 'cancelled';
  optionId?: string;
}

// ============================================================
// Client method params (agent → client)
// ============================================================

export interface FSReadTextFileParams {
  path: string;
}

export interface FSReadTextFileResult {
  text: string;
}

export interface FSWriteTextFileParams {
  path: string;
  text: string;
}

export interface TerminalCreateParams {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface TerminalCreateResult {
  terminalId: string;
}

export interface TerminalOutputParams {
  terminalId: string;
}

export interface TerminalOutputResult {
  exitCode?: number;
  isRunning: boolean;
  output: string;
}

export interface TerminalWaitForExitParams {
  terminalId: string;
  timeout?: number;
}

export interface TerminalWaitForExitResult {
  exitCode: number;
  output: string;
}

export interface TerminalKillParams {
  terminalId: string;
}

export interface TerminalReleaseParams {
  terminalId: string;
}

// ============================================================
// Agent method params (client → agent)
// ============================================================

export interface ACPInitializeParams {
  capabilities?: ACPCapabilities;
  clientInfo?: {
    name: string;
    version: string;
  };
  protocolVersion: string;
}

export interface ACPSessionNewParams {
  title?: string;
}

export interface ACPSessionPromptParams {
  content: ACPContentBlock[];
  sessionId: string;
}

export interface ACPSessionCancelParams {
  sessionId: string;
}

// ============================================================
// Broadcast event types (main → renderer)
// ============================================================

export interface ACPSessionUpdateEvent {
  sessionId: string;
  update: ACPSessionUpdate;
}

export interface ACPPermissionRequestEvent {
  message?: string;
  options: ACPPermissionOption[];
  requestId: string;
  sessionId: string;
  toolCall?: ACPToolCallUpdate;
}

export interface ACPSessionErrorEvent {
  error: string;
  sessionId: string;
}

export interface ACPSessionCompleteEvent {
  sessionId: string;
}
