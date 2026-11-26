import type {
  CompletionReporter,
  ToolCallRequestMessage,
  ToolCallResponseMessage,
} from '@lobechat/device-gateway-client';

type WireResult = ToolCallResponseMessage['result'];

/** The longest single local wait for a watched command (the shell's own cap). */
const COMPLETION_OBSERVATION_TIMEOUT_MS = 600_000;

interface ToolOutput {
  content: string;
  error?: unknown;
  state?: unknown;
  success: boolean;
}

interface ReplyLogger {
  error: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
}

export const serializeWireError = (err: unknown): string | undefined => {
  if (err === undefined || err === null) return undefined;
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

/**
 * Forward the typed envelope unchanged. Critically, do NOT stringify the whole
 * result into `content` — that would bury the structured payload inside a JSON
 * blob and lose `state`. The wire protocol carries each field separately so
 * downstream (`DeviceGateway` → `RuntimeExecutors`) can persist `state` to
 * `pluginState`. Optional fields are only set when present so payloads stay
 * minimal.
 */
export const toWireResult = (output: ToolOutput, executionTimeMs?: number): WireResult => {
  const wire: WireResult = { content: output.content, success: output.success };
  if (executionTimeMs !== undefined) wire.executionTimeMs = executionTimeMs;
  const wireError = serializeWireError(output.error);
  if (wireError !== undefined) wire.error = wireError;
  if (output.state !== undefined) wire.state = output.state;
  return wire;
};

export interface ToolCallReplyParams {
  /** The client to report the late result through, re-read on every send. */
  getReporter: () => CompletionReporter | null | undefined;
  logger: ReplyLogger;
  request: ToolCallRequestMessage;
  result: WireResult;
  /** The same tool dispatch the gateway call used, so the late answer reads like `getCommandOutput`. */
  runTool: (identifier: string | undefined, apiName: string, args: unknown) => Promise<ToolOutput>;
}

/**
 * The reply for a finished tool call. When the server asked for a late result
 * and the command is still running, the reply says the device keeps watching
 * (`state.completionWatch`) and the final `getCommandOutput` answer is reported
 * once the process exits — so the server can park the run instead of the model
 * polling.
 */
export const prepareToolCallReply = async ({
  getReporter,
  logger,
  request,
  result,
  runTool,
}: ToolCallReplyParams): Promise<WireResult> => {
  if (!request.completion || !request.operationId) return result;

  const { resolveWatchableShell, watchToolCallCompletion, withCompletionWatch } =
    await import('@lobechat/device-gateway-client');
  const shellId = resolveWatchableShell(request, result);
  if (!shellId) return result;

  const { identifier } = request.toolCall;
  void watchToolCallCompletion({
    getReporter,
    logger,
    observe: async () => {
      const output = await runTool(identifier, 'getCommandOutput', {
        shell_id: shellId,
        timeout: COMPLETION_OBSERVATION_TIMEOUT_MS,
      });
      const running = (output.state as { running?: unknown } | undefined)?.running === true;
      return { done: output.success === false || !running, result: toWireResult(output) };
    },
    operationId: request.operationId,
    toolCallId: request.completion.toolCallId,
  }).catch((error) => {
    logger.error(`Completion watch for ${shellId} failed:`, serializeWireError(error));
  });

  return withCompletionWatch(result);
};
