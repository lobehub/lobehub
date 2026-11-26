import {
  type CompletionReporter,
  resolveWatchableShell,
  type ToolCallRequestMessage,
  type ToolCallResponseMessage,
  watchToolCallCompletion,
  withCompletionWatch,
} from '@lobechat/device-gateway-client';

import { executeToolCall } from '../../tools';

type WireResult = ToolCallResponseMessage['result'];

/** The longest single local wait for a watched command (the shell's own cap). */
const COMPLETION_OBSERVATION_TIMEOUT_MS = 600_000;

export interface CompletionReplyOptions {
  getReporter: () => CompletionReporter | null | undefined;
  getToolAuth: () => Parameters<typeof executeToolCall>[3];
  logger: {
    error: (...args: any[]) => void;
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
  };
}

/**
 * The reply for a finished tool call. When the server asked for a late result
 * and the command is still running, the reply says this device keeps watching
 * (`state.completionWatch`) and the final `getCommandOutput` answer is reported
 * once the process exits — the server parks the run instead of the model
 * polling.
 *
 * The watch runs outside `maintenance.run` on purpose: a command can run for
 * hours, and a CLI restart must not wait on it. A restart loses the watch; the
 * server's own deadline then closes the call.
 */
export const prepareCompletionReply = (
  request: ToolCallRequestMessage,
  result: WireResult,
  { getReporter, getToolAuth, logger }: CompletionReplyOptions,
): WireResult => {
  const shellId = resolveWatchableShell(request, result);
  if (!shellId || !request.operationId || !request.completion) return result;

  void watchToolCallCompletion({
    getReporter,
    logger,
    observe: async () => {
      const output = await executeToolCall(
        'getCommandOutput',
        JSON.stringify({ shell_id: shellId, timeout: COMPLETION_OBSERVATION_TIMEOUT_MS }),
        COMPLETION_OBSERVATION_TIMEOUT_MS,
        getToolAuth(),
      );
      const running = (output.state as { running?: unknown } | undefined)?.running === true;
      const final: WireResult = { content: output.content, success: output.success };
      if (output.error !== undefined) final.error = output.error;
      if (output.state !== undefined) final.state = output.state;
      return { done: output.success === false || !running, result: final };
    },
    operationId: request.operationId,
    toolCallId: request.completion.toolCallId,
  }).catch((err) => {
    logger.error(
      `Completion watch for ${shellId} failed: ${err instanceof Error ? err.message : err}`,
    );
  });

  return withCompletionWatch(result);
};
