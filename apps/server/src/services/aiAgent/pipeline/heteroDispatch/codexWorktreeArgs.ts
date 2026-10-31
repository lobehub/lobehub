import { getCliConfigValue, HETERO_EXEC_AGENT_ARG_FLAG } from '@lobechat/types';

const WRITABLE_ROOTS_KEY = 'sandbox_workspace_write.writable_roots';

/** Reads the entries of a TOML string array: basic (`"…"`) or literal (`'…'`) strings. */
const parseTomlStringArray = (raw: string): string[] => {
  const entries: string[] = [];
  for (const [, basic, literal] of raw.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
    if (literal !== undefined) {
      entries.push(literal);
      continue;
    }
    try {
      entries.push(JSON.parse(`"${basic}"`));
    } catch {
      // An escape JSON cannot read; Codex will reject the provider's value itself.
    }
  }
  return entries;
};

/**
 * `lh hetero exec` args that keep the topic's selected worktree writable for a
 * device Codex run.
 *
 * The run is spawned in the source repo, and worktrees sit beside it
 * (`deriveWorktreePath`), so a provider configured with `--full-auto` or
 * `--sandbox workspace-write` would otherwise get a sandbox that cannot write the
 * worktree the system context points it at. Without a restricted sandbox Codex
 * ignores the setting. A `-c` override replaces the list instead of extending it,
 * so roots the provider already sets are carried over.
 */
export const buildCodexWorktreeWritableArgs = (params: {
  providerArgs?: string[];
  sourceDirectory?: string;
  worktreePath?: string;
}): string[] => {
  const { providerArgs, sourceDirectory, worktreePath } = params;
  if (!worktreePath || worktreePath === sourceDirectory) return [];

  const configured = getCliConfigValue(providerArgs, WRITABLE_ROOTS_KEY);
  const roots = configured ? parseTomlStringArray(configured) : [];
  if (roots.includes(worktreePath)) return [];

  return [
    `${HETERO_EXEC_AGENT_ARG_FLAG}=-c`,
    `${HETERO_EXEC_AGENT_ARG_FLAG}=${WRITABLE_ROOTS_KEY}=${JSON.stringify([...roots, worktreePath])}`,
  ];
};
