import type {
  ClaudeCodeControlRequest,
  ClaudeCodeControlRequestHandle,
} from '@lobechat/heterogeneous-agents/spawn';
import type { CodexCollaborationMode } from '@lobechat/types';

/**
 * A command the server queued for this run (`enqueueHeteroControl`), handed
 * out by `aiAgent.waitHeteroSteer` to a poller that declares `acceptsControl`.
 */
export interface HeteroControlMessage {
  command: string;
  createdAt: number;
  id: string;
  params: unknown;
}

/** What the run reports back through `aiAgent.reportHeteroControlResult`. */
export type HeteroControlReport =
  { data?: unknown; status: 'ok' } | { status: 'unsupported' } | { error: string; status: 'error' };

/** What a command handler gets to act on the running session. */
export interface HeteroControlContext {
  /** The control message's id, for logs. */
  controlId: string;
  operationId: string;
  /** The command's parameters, as queued; validate them before use. */
  params: unknown;
  /**
   * Write a stream-json `control_request` into this run's Claude Code stdin
   * (`{ subtype: 'stop_task', task_id }`…) and get its `control_response`.
   * `undefined` once the session's input closed. Bound the wait on the
   * answer: Claude Code may not answer a subtype it does not know.
   */
  sendControlRequest: (
    request: ClaudeCodeControlRequest,
  ) => ClaudeCodeControlRequestHandle | undefined;
  /** (native Codex) Switch the thread's collaboration mode from its next turn. */
  setCollaborationMode?: (mode: CodexCollaborationMode) => Promise<void>;
  /** Aborted when the run's event stream ends. */
  signal: AbortSignal;
}

/**
 * Handles one control command. Its return value is reported as `ok` with
 * `data`; a throw is reported as `error` with the error's message.
 */
export type HeteroControlHandler = (context: HeteroControlContext) => unknown;

/**
 * Command handlers by command name. Empty until a command ships: an unknown
 * command is reported `unsupported`, so the server can tell "this `lh` does
 * not know it" from "it failed".
 */
const handlers = new Map<string, HeteroControlHandler>();

/**
 * Register the handler for `command`, replacing any earlier one.
 *
 * @returns a function that removes it again
 */
export const registerHeteroControlHandler = (
  command: string,
  handler: HeteroControlHandler,
): (() => void) => {
  handlers.set(command, handler);
  return () => {
    if (handlers.get(command) === handler) handlers.delete(command);
  };
};

/** Run the handler for a control message and say how it went; never throws. */
export const dispatchHeteroControl = async (
  message: HeteroControlMessage,
  context: Omit<HeteroControlContext, 'controlId' | 'params'>,
): Promise<HeteroControlReport> => {
  const handler = handlers.get(message.command);
  if (!handler) return { status: 'unsupported' };

  try {
    const data = await handler({ ...context, controlId: message.id, params: message.params });
    return data === undefined ? { status: 'ok' } : { data, status: 'ok' };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    // The server keeps at most this much of an error message.
    return { error: (text || 'The control handler failed').slice(0, 4000), status: 'error' };
  }
};
