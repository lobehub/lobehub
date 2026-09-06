import type { RunCommandState } from '@lobechat/builtin-tool-local-system';
import { localSystemExecutor } from '@lobechat/builtin-tool-local-system/client/executor';
import type { ToolAfterCallContext } from '@lobechat/types';

import { recordGitCommandEffects } from './worktreeDetection';

/**
 * Pull the shell command out of `runCommand`'s parsed params. Only reads
 * `command`/`cmd` — never `content` — so a file-write tool can't be mistaken
 * for a shell command. Same contract as the heterogeneous CLI executors'
 * `readShellCommand`; `runCommand` always ships a string, but accepting the
 * argv-array form keeps the two paths uniform at zero cost.
 */
const readShellCommand = (params: unknown): string | string[] | undefined => {
  if (!params || typeof params !== 'object') return undefined;
  const raw = (params as { cmd?: unknown; command?: unknown }).command ?? (params as any).cmd;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.every((t) => typeof t === 'string')) return raw as string[];
  return undefined;
};

/**
 * `result.success` on a native `runCommand` only says the invocation was
 * dispatched: `ComputerRuntime.runCommand` returns top-level success once the
 * device answered, even when the spawned command exited nonzero — and the shell
 * layer's own nested `success` bit means merely "no spawn error". The one
 * signal that proves the command ran to completion and succeeded is a zero
 * exit code in the nested {@link RunCommandState}, so require exactly that.
 * Background commands (spawned, terminal status unknown — no exit code yet)
 * and timed-out ones fail closed here: recording a `git switch` that never
 * happened would overwrite the topic's branch and drop its upstream/PR
 * binding, which is worse than missing a recording.
 */
const commandExitedCleanly = (state: unknown): boolean =>
  !!state && typeof state === 'object' && (state as RunCommandState).exitCode === 0;

/**
 * Local System executor wrapped with the shell side-effect recorder.
 *
 * The package's own executor handles invocation; this adds the renderer-side
 * `onAfterCall` hook the dispatcher (`gatewayEventHandler.dispatchOnAfterCall`)
 * resolves by identifier, so a native agent's `runCommand` calls get the same
 * git/gh side-effect tracking (`git worktree add` / `git switch` / `git push` /
 * `gh pr create` → topic metadata) heterogeneous CLI shell calls already have.
 * Without this hook the topic's branch/PR binding silently misses every worktree
 * or PR created inside a native-agent run.
 */
class LocalSystemExecutorWithGitEffects {
  readonly identifier = localSystemExecutor.identifier;

  invoke = localSystemExecutor.invoke.bind(localSystemExecutor);

  getApiNames = localSystemExecutor.getApiNames.bind(localSystemExecutor);

  hasApi = localSystemExecutor.hasApi.bind(localSystemExecutor);

  onAfterCall = async ({
    apiName,
    params,
    result,
    topicId,
  }: ToolAfterCallContext): Promise<void> => {
    // Constrain to a `runCommand` bound to a run topic whose command is KNOWN to
    // have exited zero. The hetero CLI executors get away with `result.success`
    // alone because their CLIs report the command's outcome there; the native
    // result reports only dispatch, so the exit code carries the gate here.
    if (!result.success || !topicId) return;
    if (apiName !== 'runCommand') return;
    if (!commandExitedCleanly(result.state)) return;

    const command = readShellCommand(params);
    if (command === undefined) return;

    await recordGitCommandEffects({ command, resultContent: result.content, topicId });
  };
}

export const localSystemExecutorWithGitEffects = new LocalSystemExecutorWithGitEffects();
