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
    // Constrain to a SUCCESSFUL `runCommand` bound to a run topic — same gate as
    // the heterogeneous CLI executors. A failed command made no git side effect.
    if (!result.success || !topicId) return;
    if (apiName !== 'runCommand') return;

    const command = readShellCommand(params);
    if (command === undefined) return;

    await recordGitCommandEffects({ command, resultContent: result.content, topicId });
  };
}

export const localSystemExecutorWithGitEffects = new LocalSystemExecutorWithGitEffects();
