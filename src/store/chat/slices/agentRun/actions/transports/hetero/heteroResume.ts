import type { ChatTopicMetadata } from '@lobechat/types';

export type HeteroResumeBlockedReason = 'cwd_changed' | 'missing_bound_cwd';

export interface HeteroResumeDecision {
  /** True when a saved cwd exists and disagrees with the current cwd. */
  cwdChanged: boolean;
  /** Why a saved session could not be resumed safely. */
  reason?: HeteroResumeBlockedReason;
  /** Session id to resume with, or undefined when resume must be skipped. */
  resumeSessionId: string | undefined;
}

/**
 * Decide whether we can safely resume a prior heterogeneous-agent session for
 * the current turn. Claude Code CLI (the current consumer) stores sessions
 * per-cwd under `~/.claude/projects/<encoded-cwd>/`, so resuming from a
 * different cwd blows up with "No conversation found with session ID".
 *
 * Strict rule: only resume when the topic's bound `workingDirectory` is
 * present AND equals the current cwd. Legacy topics (sessionId present,
 * workingDirectory missing) are reset — we have no way to verify them,
 * and silently passing a stale id is exactly what caused the original
 * failure.
 */
export const resolveHeteroResume = (
  metadata: ChatTopicMetadata | undefined,
  currentWorkingDirectory: string | undefined,
): HeteroResumeDecision => {
  const savedSessionId = metadata?.heteroSessionId;
  const savedCwd = metadata?.workingDirectory;
  const cwd = currentWorkingDirectory ?? '';

  if (!savedSessionId) {
    return {
      cwdChanged: false,
      resumeSessionId: undefined,
    };
  }

  if (savedCwd === undefined) {
    return {
      cwdChanged: true,
      reason: 'missing_bound_cwd',
      resumeSessionId: undefined,
    };
  }

  if (savedCwd !== cwd) {
    return {
      cwdChanged: true,
      reason: 'cwd_changed',
      resumeSessionId: undefined,
    };
  }

  return {
    cwdChanged: false,
    resumeSessionId: savedSessionId,
  };
};
