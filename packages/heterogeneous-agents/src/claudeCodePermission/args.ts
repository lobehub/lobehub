import type { HeteroPermissionMode } from '@lobechat/types';

import { resolveClaudeCodePermissionMode } from './mode';

export { resolveClaudeCodePermissionMode } from './mode';

/**
 * Tools pre-approved for a root run with the lab off, where nobody can answer a
 * prompt. Never with a mode: an allow rule outlives a later switch to a
 * stricter mode (`set_permission_mode` keeps it), so it would silently approve
 * what the user then asked to be asked about.
 */
const ROOT_PRE_APPROVED_TOOLS = 'Bash,Read,Write,Edit,MultiEdit,WebSearch,mcp__*';

/** Claude Code refuses `bypassPermissions` as root (a cloud sandbox). */
export const isRunningAsRoot = (): boolean => process.getuid?.() === 0;

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
 *   Root never gets it, since Claude Code refuses it there; root's stand-in
 *   for `bypassPermissions` is plain `acceptEdits`, asking before commands.
 * - With a `mode` but no host to answer prompts (`hostPrompts: false`, e.g.
 *   the card bridge failed to start): fail closed. The mode still applies and
 *   print mode denies whatever it would have asked about; it never falls back
 *   to allowing everything.
 */
export const buildClaudeCodePermissionArgs = ({
  hostPrompts = true,
  isRoot = isRunningAsRoot(),
  mode,
}: {
  hostPrompts?: boolean;
  isRoot?: boolean;
  mode?: HeteroPermissionMode;
}): string[] => {
  if (!mode) {
    return isRoot
      ? ['--permission-mode', 'acceptEdits', '--allowed-tools', ROOT_PRE_APPROVED_TOOLS]
      : ['--permission-mode', 'bypassPermissions'];
  }

  const resolved = resolveClaudeCodePermissionMode(mode, isRoot);
  if (!hostPrompts) return ['--permission-mode', resolved.mode];
  return [
    '--permission-mode',
    resolved.mode,
    '--permission-prompt-tool',
    'stdio',
    ...(isRoot ? [] : ['--allow-dangerously-skip-permissions']),
  ];
};
