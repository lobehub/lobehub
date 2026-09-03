import type { LobeChatDatabase } from '@lobechat/database';

import { getUserExecutionPolicy } from './executionPolicy';
import { isGovernanceEnabled } from './policyGate';
import type { CommandExecutionLogPolicyField, CommandGovernanceContext } from './types';

/**
 * The file-operation-shaped view of `CommandGovernanceContext`: `path`
 * required, `commandText` never set. Passing this straight into
 * `logCommandExecution` (which takes the full `CommandGovernanceContext`)
 * needs no cast — both are the same underlying shape.
 */
export type PathGovernanceContext = Omit<CommandGovernanceContext, 'commandText' | 'path'> & {
  /** The path the model asked to read/write. */
  path: string;
};

export interface PathGovernanceDecision {
  allowed: boolean;
  matchedField?: CommandExecutionLogPolicyField;
}

/** File-operation APIs that write — checked against `deniedWriteRoots`; everything else is a read, checked against `deniedReadRoots`. */
const WRITE_API_NAMES = new Set(['writeFile', 'editFile', 'moveFiles']);

/**
 * The tool-result message shown to the model when `checkPath` denies a file
 * operation. Sibling of `COMMAND_BLOCKED_MESSAGE` (`policyGate.ts`) — same
 * rationale: a bare "this path is blocked" has been observed producing a
 * retry against a slightly different path rather than stopping, so the
 * message states explicitly that this is a standing policy decision, not a
 * transient error, and that no path under the same denied root will succeed.
 */
export const FILE_BLOCKED_MESSAGE =
  'This file operation was blocked by an administrator-configured execution policy for this ' +
  'user. This is a policy decision, not a transient error — retrying this path, a nearby path ' +
  'under the same directory, or an equivalent operation will be blocked again. Do not attempt ' +
  'to read or write this path again in any form. Stop this line of action now and tell the ' +
  "user the operation was blocked by their administrator's policy.";

/**
 * Text-level suffix/substring match, not real path resolution — the server
 * does not know a remote device's real home directory, so `~/.ssh` is
 * compared against everything after the `~` rather than an expanded absolute
 * path. Deliberately the same tradeoff as `checkCommand`'s pattern matching:
 * defense in depth, not a filesystem-precise sandbox — see
 * `docs/文件操作治理-实施指南-20260902.md` §1 for why this (and not device-reported
 * home directories) was chosen for a first version.
 *
 * Also does the full-width-character correction (`.normalize('NFKC')`) that
 * caused the original bug report — a rule authored with a full-width `～`
 * must still match a real half-width `~/.ssh` path.
 */
export const pathMatchesRoot = (targetPath: string, root: string): boolean => {
  const normalize = (value: string) => value.normalize('NFKC').replaceAll('\\', '/');

  const normalizedTarget = normalize(targetPath);
  const normalizedRoot = normalize(root).replace(/^~\/?/, '');
  if (!normalizedRoot) return false;

  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.endsWith(`/${normalizedRoot}`) ||
    normalizedTarget.includes(`/${normalizedRoot}/`)
  );
};

/**
 * Evaluate whether `ctx.path` is allowed for `ctx.apiName`, against the
 * calling user's `user_execution_policies` row.
 *
 * FAIL-OPEN BY DESIGN, same posture as `checkCommand`: feature disabled, no
 * policy configured, or an internal error all resolve to `{ allowed: true }`.
 * File-path governance is defense-in-depth, not the user's only safety net.
 */
export const checkPath = async (
  ctx: PathGovernanceContext,
  db: LobeChatDatabase,
): Promise<PathGovernanceDecision> => {
  if (!isGovernanceEnabled()) return { allowed: true };

  try {
    const policy = await getUserExecutionPolicy(ctx.userId, db);
    if (!policy) return { allowed: true };

    const isWrite = WRITE_API_NAMES.has(ctx.apiName);
    const deniedRoots = isWrite ? policy.deniedWriteRoots : policy.deniedReadRoots;
    if (!deniedRoots?.length) return { allowed: true };

    const matchedField: CommandExecutionLogPolicyField = isWrite
      ? 'deniedWriteRoots'
      : 'deniedReadRoots';
    const hit = deniedRoots.some((root) => pathMatchesRoot(ctx.path, root));

    return hit ? { allowed: false, matchedField } : { allowed: true };
  } catch (error) {
    console.error('[governance] checkPath failed, failing open (allowed=true): %O', error);
    return { allowed: true };
  }
};
