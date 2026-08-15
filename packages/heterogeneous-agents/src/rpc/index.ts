/**
 * Pi RPC transport — `pi --mode rpc` JSONL client + per-run session wrapper.
 *
 * Replaces the legacy one-shot `--mode json` spawn for the desktop pi path:
 * a long-lived bidirectional process with command/response correlation, the
 * extension UI sub-protocol, and graceful EOF-based shutdown.
 */
export { PiRpcClient, PiRpcConnectionError, PiRpcResponseError } from './piRpcClient';
export {
  createPiRpcAgentHandle,
  toPiRpcPrompt,
  type PiRpcAgentHandle,
  type PiRpcAgentHandleOptions,
} from './piRpcAgentHandle';
export {
  PiRpcSession,
  type PiRpcPromptInput,
  type PiRpcSessionOptions,
} from './piRpcSession';
export {
  PI_RPC_DEFAULT_REQUEST_TIMEOUT_MS,
  PI_RPC_HANDSHAKE_TIMEOUT_MS,
  PI_RPC_MIN_PROTOCOL_VERSION,
  type PiAgentSettledEvent,
  type PiExtensionUiDialogMethod,
  type PiExtensionUiFireAndForgetMethod,
  type PiExtensionUiRequest,
  type PiExtensionUiResponse,
  type PiMessageEndEvent,
  type PiMessageUpdateEvent,
  type PiRpcCommand,
  type PiRpcEvent,
  type PiRpcImage,
  type PiRpcResponse,
  type PiRpcStateData,
  type PiSessionEvent,
  type PiStreamingBehavior,
} from './piRpcProtocol';
