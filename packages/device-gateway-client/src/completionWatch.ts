import type {
  ToolCallCompletionAckMessage,
  ToolCallCompletionMessage,
  ToolCallRequestMessage,
  ToolCallResponseMessage,
} from './types';

type ToolResult = ToolCallResponseMessage['result'];

const LOCAL_SYSTEM_IDENTIFIER = 'lobe-local-system';

/** Longest a device keeps a finished result it could not deliver. */
export const DEFAULT_COMPLETION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const INITIAL_RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 60_000;

interface ShellStateShape {
  commandId?: unknown;
  error?: unknown;
  exitCode?: unknown;
  isBackground?: unknown;
  running?: unknown;
}

/**
 * The shell a `runCommand` reply left running, when the server asked for a
 * late result. Mirrors the server's park predicate: a background spawn or a
 * foreground call that outlived its wait window, never a command that already
 * has an exit code or failed to start.
 */
export const resolveWatchableShell = (
  request: Pick<ToolCallRequestMessage, 'completion' | 'operationId' | 'toolCall'>,
  result: Pick<ToolResult, 'state' | 'success'>,
): string | undefined => {
  if (!request.completion?.toolCallId || !request.operationId) return undefined;
  if (request.toolCall.type === 'mcp') return undefined;
  if (request.toolCall.identifier !== LOCAL_SYSTEM_IDENTIFIER) return undefined;
  if (request.toolCall.apiName !== 'runCommand') return undefined;
  if (result.success === false) return undefined;

  const state = result.state as ShellStateShape | undefined;
  if (!state || typeof state !== 'object') return undefined;
  if (typeof state.commandId !== 'string' || !state.commandId) return undefined;
  if (state.error) return undefined;
  if (state.exitCode !== undefined && state.exitCode !== null) return undefined;
  if (state.isBackground === true || state.running === true) return state.commandId;
  return undefined;
};

/** Mark a reply so the server knows a late result will follow and may park. */
export const withCompletionWatch = (result: ToolResult): ToolResult => ({
  ...result,
  state: { ...(result.state as object), completionWatch: true },
});

export interface CompletionReporter {
  off: (event: 'connected', listener: () => void) => unknown;
  on: (event: 'connected', listener: () => void) => unknown;
  reportToolCallCompletion: (
    completion: Omit<ToolCallCompletionMessage, 'type'>,
  ) => Promise<Omit<ToolCallCompletionAckMessage, 'type'>>;
}

export interface WatchToolCallCompletionOptions {
  /** Resolves with the gateway client to report through; re-read on every send. */
  getReporter: () => CompletionReporter | null | undefined;
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void };
  maxAgeMs?: number;
  /**
   * Wait for the command and return its answer. `done: false` means the
   * observation window closed while it was still running — observe again.
   */
  observe: () => Promise<{ done: boolean; result: ToolResult }>;
  operationId: string;
  /** Test seam for the retry delay. */
  sleep?: (ms: number, wake: Promise<void>) => Promise<void>;
  toolCallId: string;
}

const defaultSleep = (ms: number, wake: Promise<void>) =>
  Promise.race([new Promise<void>((resolve) => setTimeout(resolve, ms)), wake]);

/**
 * Watch a command the device left running and deliver its final result.
 *
 * Observation is local (the device waits on its own process), so the wait costs
 * the server nothing. Delivery retries with backoff — sooner when the gateway
 * reconnects — until the gateway answers `delivered` or `rejected`, or the
 * result is older than `maxAgeMs` (the server has timed the call out by then).
 */
export const watchToolCallCompletion = async ({
  getReporter,
  logger,
  maxAgeMs = DEFAULT_COMPLETION_MAX_AGE_MS,
  observe,
  operationId,
  sleep = defaultSleep,
  toolCallId,
}: WatchToolCallCompletionOptions): Promise<ToolCallCompletionAckMessage['status'] | 'expired'> => {
  const startedAt = Date.now();

  let result: ToolResult;
  for (;;) {
    let observed: { done: boolean; result: ToolResult };
    try {
      observed = await observe();
    } catch (error) {
      // The device can no longer tell what happened to the command (the shell
      // was cleaned up, the runtime threw). Report that rather than nothing, so
      // the run resumes with an error instead of waiting for its timeout.
      const message = error instanceof Error ? error.message : String(error);
      observed = {
        done: true,
        result: {
          content: `Failed to observe the command: ${message}`,
          error: message,
          success: false,
        },
      };
    }
    if (observed.done) {
      result = observed.result;
      break;
    }
    if (Date.now() - startedAt > maxAgeMs) return 'expired';
  }

  let delay = INITIAL_RETRY_DELAY_MS;
  for (;;) {
    const reporter = getReporter();
    if (reporter) {
      try {
        const ack = await reporter.reportToolCallCompletion({ operationId, result, toolCallId });
        if (ack.status !== 'retry') {
          logger?.info(`Completion for ${toolCallId} ${ack.status}`, ack.reason ?? '');
          return ack.status;
        }
        logger?.warn(`Completion for ${toolCallId} not taken yet`, ack.reason ?? '');
      } catch (error) {
        logger?.warn(
          `Completion for ${toolCallId} not sent`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (Date.now() - startedAt > maxAgeMs) return 'expired';

    let onConnected: (() => void) | undefined;
    const wake = new Promise<void>((resolve) => {
      onConnected = resolve;
      reporter?.on('connected', resolve);
    });
    await sleep(delay, wake);
    if (onConnected) reporter?.off('connected', onConnected);
    delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
  }
};
