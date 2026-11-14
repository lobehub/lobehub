import debug from 'debug';

import { invokeExecutor } from '@/store/tool/slices/builtin/executors';

const log = debug('lobe-store:deferred-shell');

/** How long each device-side observation waits before re-checking. */
const OBSERVE_WINDOW_MS = 30_000;
/** Local safety cap; the server's own deadline is authoritative. */
const MAX_WATCH_MS = 2 * 60 * 60 * 1000;

export interface DeferredShellResult {
  content: string | null;
  error?: { message: string; type?: string };
  state?: Record<string, unknown>;
  success: boolean;
}

interface ShellCommandState {
  commandId?: unknown;
  error?: unknown;
  exitCode?: unknown;
  isBackground?: unknown;
  running?: unknown;
  success?: unknown;
}

/**
 * Whether this `runCommand` handed off a command that is still running.
 *
 * Mirrors the server's `<AsyncShellPark>` predicate: the row is only parked when
 * both sides agree, so a mismatch here means a late result nobody consumes —
 * harmless (the queue entry expires) but pointless.
 */
export const deferredShellId = (
  identifier: string,
  apiName: string,
  localSystemIdentifier: string,
  state: unknown,
): string | undefined => {
  if (identifier !== localSystemIdentifier || apiName !== 'runCommand') return undefined;
  if (!state || typeof state !== 'object') return undefined;

  const shell = state as ShellCommandState;
  if (typeof shell.commandId !== 'string' || shell.commandId.length === 0) return undefined;
  if (shell.error) return undefined;
  if (shell.exitCode !== undefined && shell.exitCode !== null) return undefined;
  if (shell.success === false) return undefined;
  if (shell.isBackground === true || shell.running === true) return shell.commandId;
  return undefined;
};

/**
 * Watch a command the server has parked on, from the device that runs it.
 *
 * The wait itself costs nothing on the server: the operation is parked and the
 * run resumes from this device's completion report. All this does is observe
 * locally (the same `getCommandOutput` the model used to poll, but at IPC cost
 * and without an LLM turn each time) and hand the final result back once.
 *
 * Stops on abort, on the local cap, or when the shell reports a terminal state.
 */
export const watchDeferredShell = async (params: {
  commandId: string;
  identifier: string;
  onComplete: (result: DeferredShellResult) => void;
  signal?: AbortSignal;
  toolCallId: string;
}): Promise<void> => {
  const { commandId, identifier, onComplete, signal, toolCallId } = params;
  const deadline = Date.now() + MAX_WATCH_MS;
  const ctx = { toolCallId } as any;

  log('watching %s for toolCall %s', commandId, toolCallId);

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      log('watch aborted for %s', commandId);
      return;
    }

    let output: any;
    try {
      output = await invokeExecutor(
        identifier,
        'getCommandOutput',
        // A long observation window wakes the moment the process exits, so a
        // quick command costs one call and a slow one costs one per window —
        // never a tight loop.
        { shell_id: commandId, timeout: OBSERVE_WINDOW_MS },
        ctx,
      );
    } catch (error) {
      log('observation failed for %s: %O', commandId, error);
      onComplete({
        content: null,
        error: {
          message: `Lost track of the running command (${commandId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
          type: 'shell_observation_failed',
        },
        success: false,
      });
      return;
    }

    const state = (output?.state ?? {}) as ShellCommandState;
    if (state.running === true) continue;

    // `success: false` with no exit code means the device lost the session
    // (restarted, or the command belongs to another process). Report it rather
    // than waiting for a command that no longer exists.
    if (state.success === false && state.exitCode === undefined) {
      onComplete({
        content: output?.content ?? null,
        error: {
          message: output?.content || `Command ${commandId} is no longer available on this device`,
          type: 'shell_session_lost',
        },
        state: output?.state,
        success: false,
      });
      return;
    }

    onComplete({
      content: output?.content ?? null,
      // The executor normalizes an IPC rejection into a plain failed result
      // (`{ content, error, success: false }`) with no shell state at all.
      // Deriving the outcome from `state.success` alone would report that as a
      // completed command and drop the failure the server needs to record.
      error:
        output?.success === false
          ? (output.error as DeferredShellResult['error'] | undefined)
          : undefined,
      state: output?.state,
      success: output?.success !== false && state.success !== false,
    });
    return;
  }

  log('watch hit the local cap for %s', commandId);
  onComplete({
    content: null,
    error: {
      message: `Stopped watching command ${commandId} after the local limit. It may still be running.`,
      type: 'shell_watch_expired',
    },
    success: false,
  });
};
