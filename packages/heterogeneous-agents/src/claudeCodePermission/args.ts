import type { HeteroPermissionMode, HeteroPermissionModeFallback } from '@lobechat/types';

/** Tools pre-approved when `acceptEdits` stands in for `bypassPermissions` as root. */
const ROOT_PRE_APPROVED_TOOLS = 'Bash,Read,Write,Edit,MultiEdit,WebSearch,mcp__*';

/** Claude Code refuses `bypassPermissions` as root (a cloud sandbox). */
export const isRunningAsRoot = (): boolean => process.getuid?.() === 0;

/**
 * The mode Claude Code can actually run in: as root, `bypassPermissions` falls
 * back to `acceptEdits` (with the common tools pre-approved at spawn).
 */
export const resolveClaudeCodePermissionMode = (
  mode: HeteroPermissionMode,
  isRoot: boolean = isRunningAsRoot(),
): { fallback?: HeteroPermissionModeFallback; mode: HeteroPermissionMode } =>
  isRoot && mode === 'bypassPermissions' ? { fallback: 'root', mode: 'acceptEdits' } : { mode };

/**
 * Claude Code permission flags for one spawn, shared by every CLI host
 * (desktop IPC, `lh hetero exec`).
 *
 * - No `mode` (Better Coding Experience lab off): every action is allowed, as
 *   before — `bypassPermissions`, or `acceptEdits` with the common tools
 *   pre-approved as root. Nothing asks the host.
 * - With a `mode`: Claude Code asks the host over stdio
 *   (`--permission-prompt-tool stdio`) whenever the mode wants a decision.
 *   `--allow-dangerously-skip-permissions` only PERMITS a later switch to
 *   `bypassPermissions` (the mode chip, approving a plan with "don't ask
 *   again"): without it Claude Code silently turns that switch into `default`.
 *   Root never gets it, since Claude Code refuses it there.
 */
export const buildClaudeCodePermissionArgs = ({
  isRoot = isRunningAsRoot(),
  mode,
}: {
  isRoot?: boolean;
  mode?: HeteroPermissionMode;
}): string[] => {
  const rootFallbackArgs = [
    '--permission-mode',
    'acceptEdits',
    '--allowed-tools',
    ROOT_PRE_APPROVED_TOOLS,
  ];
  if (!mode) return isRoot ? rootFallbackArgs : ['--permission-mode', 'bypassPermissions'];

  const resolved = resolveClaudeCodePermissionMode(mode, isRoot);
  if (resolved.fallback === 'root')
    return [...rootFallbackArgs, '--permission-prompt-tool', 'stdio'];

  return [
    '--permission-mode',
    resolved.mode,
    '--permission-prompt-tool',
    'stdio',
    ...(isRoot ? [] : ['--allow-dangerously-skip-permissions']),
  ];
};
