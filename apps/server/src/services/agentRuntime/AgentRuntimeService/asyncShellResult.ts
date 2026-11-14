import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';

const log = debug('lobe-server:agent-runtime:async-shell');

export interface DeferredShellResult {
  content: string | null;
  error?: { message: string; type?: string };
  executionTimeMs?: number;
  state?: Record<string, unknown>;
  success: boolean;
  toolCallId: string;
}

export interface AsyncShellResultDeps {
  messageModel: Pick<MessageModel, 'findMessagePlugin' | 'updateToolMessage'>;
  /**
   * Override for {@link PLACEHOLDER_WAIT}, used by tests to keep the wait
   * instant. Production callers leave it out.
   */
  placeholderWait?: { attempts: number; intervalMs: number };
  serverDB: LobeChatDatabase;
  /** Barrier + single-fire CAS + re-dispatch of the parked step. */
  tryResumeParentFromAsyncTool: (
    params: { parentOperationId: string },
    options?: { knownFulfilledMessageId?: string; scheduleVerifyOnHold?: boolean },
  ) => Promise<boolean>;
}

/** The placeholder state written by `parkAsyncShell`. */
interface AsyncShellPluginState {
  asyncShell?: {
    commandId?: string;
    startedAt?: string;
    timeoutMs?: number;
  };
  status?: string;
}

export interface CompleteDeferredShellParams {
  /** Operation the parked step belongs to (the gateway's operation id). */
  operationId: string;
  /**
   * Why the placeholder is being closed. `timeout` comes from the scheduled
   * deadline, not from the device: the command may still be running there, so
   * the text has to say so instead of claiming a failure that did not happen.
   */
  reason?: 'device_result' | 'timeout';
  result: DeferredShellResult;
}

export type CompleteDeferredShellOutcome =
  | { handled: false; reason: 'not_deferred_shell' }
  /**
   * The completion itself is fine, but its placeholder never showed up. Only
   * reachable when a device reports a command it already saw start, so the
   * caller must keep the result instead of acknowledging it away.
   */
  | { handled: false; reason: 'placeholder_missing' }
  | { handled: true; resumed: boolean };

/**
 * The command outlived its deadline. Say what is actually true: the run was
 * parked and gave up waiting — not that the command failed. The shell id lets
 * the model check on it (or kill it) instead of assuming the work was undone.
 */
const timeoutContent = (commandId?: string, timeoutMs?: number): string => {
  const minutes = Math.round((timeoutMs ?? 0) / 60_000) || undefined;
  const waited = minutes ? `${minutes} minutes` : 'the configured wait';
  const shell = commandId ? ` (shell_id: ${commandId})` : '';
  return (
    `Command did not finish within ${waited}${shell}. ` +
    'It may still be running on the device — use getCommandOutput to check on it, or killCommand to stop it.'
  );
};

/** What the model sees when the command produced no text of its own. */
const synthesizeContent = (result: DeferredShellResult): string => {
  if (result.content && result.content.trim().length > 0) return result.content;

  const exitCode = (result.state as { exitCode?: unknown } | undefined)?.exitCode;
  if (typeof exitCode === 'number' && exitCode !== 0) {
    return `Command failed with exit code ${exitCode}.`;
  }
  return result.error ? `Command failed: ${result.error.message}` : 'Command completed.';
};

/**
 * How long a completion keeps looking for its placeholder before it is taken to
 * belong to something else.
 *
 * The device starts `watchDeferredShell` as soon as it has sent the running
 * receipt, while the server writes the placeholder only after that receipt has
 * come back through `dispatchClientTool`. A command that ends quickly can
 * therefore report completion before the row exists — and that report is the
 * only copy of its answer. Poll briefly for it rather than declaring the result
 * foreign on the first miss.
 */
const PLACEHOLDER_WAIT = { attempts: 6, intervalMs: 250 };

const findPlaceholder = async (deps: AsyncShellResultDeps, toolCallId: string) => {
  const { attempts, intervalMs } = deps.placeholderWait ?? PLACEHOLDER_WAIT;

  for (let attempt = 0; ; attempt++) {
    const plugin = await deps.serverDB.query.messagePlugins.findFirst({
      where: (mp, { eq: eqOp }) => eqOp(mp.toolCallId, toolCallId),
    });
    if (plugin || attempt >= attempts) return plugin;

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

/**
 * Finish a shell command that outlived its tool call.
 *
 * The device reports the command's completion long after the dispatching step
 * ended, so there is no BLPOP waiter: the operation is parked, and its
 * placeholder tool message is waiting for this write. Backfilling it and then
 * resuming the parked operation is exactly the path the sub-agent bridge uses,
 * which is why the barrier, the single-fire CAS and the verify watchdog are all
 * reused here rather than re-implemented.
 *
 * Returns `handled: false` for a result that is not ours (a normal synchronous
 * tool result racing the queue path, `not_deferred_shell`) or for one whose
 * placeholder has not been written yet (`placeholder_missing`). The two are not
 * interchangeable: the first can be dropped, the second is the only copy of the
 * command's answer and the caller has to keep it.
 */
export async function completeDeferredShell(
  deps: AsyncShellResultDeps,
  { operationId, reason = 'device_result', result }: CompleteDeferredShellParams,
): Promise<CompleteDeferredShellOutcome> {
  const plugin = await findPlaceholder(deps, result.toolCallId);
  if (!plugin) return { handled: false, reason: 'placeholder_missing' };

  const pluginState = plugin.state as AsyncShellPluginState | null;
  if (!pluginState?.asyncShell) return { handled: false, reason: 'not_deferred_shell' };

  const exitCode = (result.state as { exitCode?: unknown } | undefined)?.exitCode;
  const timedOut = reason === 'timeout';
  const failed =
    timedOut ||
    result.success === false ||
    result.error !== undefined ||
    (typeof exitCode === 'number' && exitCode !== 0);

  const content = timedOut
    ? timeoutContent(pluginState.asyncShell.commandId, pluginState.asyncShell.timeoutMs)
    : synthesizeContent(result);
  const backfill = await deps.messageModel.updateToolMessage(plugin.id, {
    content,
    pluginError:
      result.error ??
      (timedOut
        ? { message: 'Command did not finish within its wait window.', type: 'timeout' }
        : null),
    pluginState: {
      ...pluginState,
      error: result.error,
      exitCode,
      finishedAt: new Date().toISOString(),
      status: failed ? 'error' : 'completed',
    },
    onlyIfEmpty: true,
  });

  if (!backfill.success) {
    // Leave the operation parked: the verify watchdog and the caller's retry
    // both need the placeholder unchanged, and a partial write would look
    // fulfilled to the barrier.
    throw new Error(
      `async shell: failed to backfill tool message ${plugin.id} (op=${operationId}, tool=${result.toolCallId})`,
    );
  }

  log(
    'shell completed: op=%s tool=%s message=%s exit=%s',
    operationId,
    result.toolCallId,
    plugin.id,
    String(exitCode),
  );

  const resumed = await deps.tryResumeParentFromAsyncTool(
    { parentOperationId: operationId },
    { knownFulfilledMessageId: plugin.id, scheduleVerifyOnHold: true },
  );

  return { handled: true, resumed };
}
