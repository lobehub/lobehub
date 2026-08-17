/**
 * Pi RPC protocol wire types.
 *
 * `pi --mode rpc` speaks a JSONL command/response protocol over stdio:
 * commands are JSON objects on stdin (one per line), responses and agent
 * events are JSON objects on stdout. Responses carry `type: 'response'` and
 * echo the optional `id` of the command they answer; events stream
 * asynchronously and carry no id.
 *
 * See pi's `docs/rpc.md` for the authoritative protocol description.
 */

/** Base64-encoded image attachment for a prompt / steer / follow_up command. */
export interface PiRpcImage {
  /** Base64-encoded image bytes. */
  data: string;
  /** IANA media type, e.g. `image/png`. */
  mimeType: string;
  type: 'image';
}

/** How a prompt is delivered while the agent is already streaming. */
export type PiStreamingBehavior = 'steer' | 'followUp';

/** Commands the host can send to a `pi --mode rpc` process. */
export type PiRpcCommand =
  | {
      id?: string;
      type: 'prompt';
      message: string;
      images?: PiRpcImage[];
      streamingBehavior?: PiStreamingBehavior;
    }
  | { id?: string; type: 'steer'; message: string; images?: PiRpcImage[] }
  | { id?: string; type: 'follow_up'; message: string; images?: PiRpcImage[] }
  | { id?: string; type: 'abort' }
  | { id?: string; type: 'abort_retry' }
  | { id?: string; type: 'new_session'; parentSession?: string }
  | { id?: string; type: 'switch_session'; sessionPath: string }
  | { id?: string; type: 'get_state' }
  | { id?: string; type: 'get_messages' }
  | { id?: string; type: 'get_entries'; since?: string }
  | { id?: string; type: 'get_tree' }
  | { id?: string; type: 'get_commands' }
  | { id?: string; type: 'get_available_models' }
  | { id?: string; type: 'get_session_stats' }
  | { id?: string; type: 'get_available_thinking_levels' }
  | { id?: string; type: 'set_model'; provider: string; modelId: string }
  | { id?: string; type: 'set_thinking_level'; level: string }
  | { id?: string; type: 'set_steering_mode'; mode: 'all' | 'one-at-a-time' }
  | { id?: string; type: 'set_follow_up_mode'; mode: 'all' | 'one-at-a-time' }
  | { id?: string; type: 'compact'; customInstructions?: string }
  | { id?: string; type: 'set_auto_compaction'; enabled: boolean }
  | { id?: string; type: 'set_auto_retry'; enabled: boolean }
  | { id?: string; type: 'bash'; command: string }
  | { id?: string; type: 'abort_bash' }
  | { id?: string; type: 'set_session_name'; name: string };

/** Response to a command. `success: false` carries a human-readable `error`. */
export interface PiRpcResponse<T = any> {
  command: string;
  data?: T;
  error?: string;
  id?: string;
  success: boolean;
  type: 'response';
}

/** Subset of `get_state` data the host uses for handshake / diagnostics. */
export interface PiRpcStateData {
  isCompacting?: boolean;
  isStreaming?: boolean;
  messageCount?: number;
  model?: { id?: string; name?: string } | null;
  pendingMessageCount?: number;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  thinkingLevel?: string;
}

/** Dialog methods that block until the host answers with a response. */
export type PiExtensionUiDialogMethod = 'select' | 'confirm' | 'input' | 'editor';
/** Fire-and-forget methods — the host may display or ignore them. */
export type PiExtensionUiFireAndForgetMethod =
  'notify' | 'setStatus' | 'setWidget' | 'setTitle' | 'set_editor_text';

/**
 * A request emitted by an extension via the extension UI protocol. Dialog
 * methods block on stdout until the host sends a matching
 * `extension_ui_response` on stdin; fire-and-forget methods never get one.
 */
export interface PiExtensionUiRequest {
  /** Correlation id — must be echoed by the response. */
  id: string;
  message?: string;
  method: PiExtensionUiDialogMethod | PiExtensionUiFireAndForgetMethod;
  notifyType?: 'info' | 'warning' | 'error';
  options?: string[];
  placeholder?: string;
  prefill?: string;
  statusKey?: string;
  statusText?: string;
  /** Dialog methods may auto-resolve server-side when this elapses. */
  timeout?: number;
  title?: string;
  type: 'extension_ui_request';
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: 'aboveEditor' | 'belowEditor';
}

/** The host's answer to a dialog `extension_ui_request`. */
export interface PiExtensionUiResponse {
  /** Cancel — pi resolves the extension with `undefined` / `false`. */
  cancelled?: boolean;
  /** Confirmation answer (confirm). */
  confirmed?: boolean;
  id: string;
  type: 'extension_ui_response';
  /** Value answer (select / input / editor). */
  value?: string;
}

/** A raw agent event emitted by the RPC process (subset used by the host). */
export interface PiRpcEvent {
  [key: string]: any;
  type: string;
}

/** The `session` event that reports the native pi session id at startup. */
export interface PiSessionEvent extends PiRpcEvent {
  id: string;
  type: 'session';
}

/** The `agent_settled` event — the whole prompt (incl. recovery) is done. */
export interface PiAgentSettledEvent extends PiRpcEvent {
  type: 'agent_settled';
}

/** A `message_update` event (delta stream). */
export interface PiMessageUpdateEvent extends PiRpcEvent {
  assistantMessageEvent?: {
    type: string;
    /** Present on `type: 'error'` updates: the failure detail. */
    error?: {
      errorMessage?: string;
      message?: string;
      model?: string;
      provider?: string;
      stopReason?: string;
      [key: string]: any;
    };
    reason?: string;
    [key: string]: any;
  };
  type: 'message_update';
}

/** A `message_end` event (authoritative message snapshot). */
export interface PiMessageEndEvent extends PiRpcEvent {
  message?: {
    role?: string;
    stopReason?: string;
    [key: string]: any;
  };
  type: 'message_end';
}

/** pi RPC protocol version floor the client is built against. */
export const PI_RPC_MIN_PROTOCOL_VERSION = '0.16.0';

/** Default timeout for a command response (pi resolves `prompt` on accept). */
export const PI_RPC_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Timeout for the startup handshake (`get_state`). */
export const PI_RPC_HANDSHAKE_TIMEOUT_MS = 15_000;
