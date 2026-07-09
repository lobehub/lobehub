import type { ToolAfterCallContext } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { recordGitCommandEffects } from './worktreeDetection';

/**
 * Hook-only executor for a heterogeneous CLI agent's tool identifier
 * (`claude-code` / `codex` — set by the adapters in
 * `packages/heterogeneous-agents/src/adapters/*`). These agents run their OWN
 * tools, so this executor is NEVER invoked: `apiEnum` is empty → `hasApi()` is
 * always false → the client-tool dispatch (`hasExecutor`) never routes to
 * `invoke`, and no phantom tool is exposed to the model.
 *
 * It exists solely so the `tool_end` dispatcher
 * (`gatewayEventHandler.dispatchOnAfterCall`, which resolves the executor by the
 * tool's `identifier`) can reach `onAfterCall` and observe the CLI's shell tool
 * results renderer-side — the same seam idiomatic builtin tools use to react to
 * their own mutations.
 */
const EMPTY_API_ENUM = {} as Record<string, string>;

/**
 * Pull the command out of a shell tool's parsed params. Only reads `command`/`cmd`
 * — never `content` — so a file-write tool can't be mistaken for a shell command.
 * Returns the raw value (string OR the argv-array form) so the detector can keep
 * argument boundaries.
 */
const readShellCommand = (params: unknown): string | string[] | undefined => {
  if (!params || typeof params !== 'object') return undefined;
  const raw = (params as { cmd?: unknown; command?: unknown }).command ?? (params as any).cmd;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.every((t) => typeof t === 'string')) return raw as string[];
  return undefined;
};

class HeteroCliExecutor extends BaseExecutor<typeof EMPTY_API_ENUM> {
  protected readonly apiEnum = EMPTY_API_ENUM;

  /**
   * @param identifier   The CLI adapter's tool identifier (`claude-code` / `codex`).
   * @param shellApiNames The adapter's shell / run-command tool api name(s). Side
   *   effects are constrained to THIS tool first, then handled uniformly — we don't
   *   sniff every tool call's params.
   */
  constructor(
    readonly identifier: string,
    private readonly shellApiNames: ReadonlySet<string>,
  ) {
    super();
  }

  onAfterCall = async ({
    apiName,
    params,
    result,
    topicId,
  }: ToolAfterCallContext): Promise<void> => {
    // Constrain to a SUCCESSFUL run of the shell tool bound to a run topic.
    if (!result.success || !topicId || !this.shellApiNames.has(apiName)) return;

    const command = readShellCommand(params);
    if (command === undefined) return;

    await recordGitCommandEffects({ command, resultContent: result.content, topicId });
  };
}

// CC's shell tool is `Bash`; Codex's is `command_execution`.
export const claudeCodeExecutor = new HeteroCliExecutor('claude-code', new Set(['Bash']));
export const codexExecutor = new HeteroCliExecutor('codex', new Set(['command_execution']));
