import { isRecord } from '@lobechat/utils/object';

/**
 * Patterns that indicate a `--resume <sessionId>` run should be retried
 * without `--resume`.  Two classes of failure:
 *   1. Session file missing (sandbox recycled): the container is ephemeral
 *      (~1 h idle TTL), so a new sandbox has an empty `~/.claude/projects/`
 *      and the stored session id is stale.
 *   2. Context overflow (long conversation): the resumed session carries all
 *      accumulated history past the model's context window, so the API rejects
 *      the request right after CC initialises. Starting fresh (no `--resume`)
 *      drops the old history and lets CC respond to the new prompt alone.
 *
 * Checked against `error` stream events (from CC's result event) and, when CC
 * exits without a result event, the accumulated stderr output.
 */
const RESUME_RETRY_PATTERNS = [
  // Session file missing — sandbox was recycled
  /no conversation found/i,
  /session.*not found/i,
  /conversation.*not found/i,
  /resume.*not found/i,
  // Codex reports a missing saved thread (exec and app-server alike) as
  // "thread/resume failed: no rollout found for thread id <id>".
  /no rollout found/i,
  // Context overflow — API rejected the resumed session's accumulated history
  /prompt.*too long/i,
  /context.*too long/i,
  /context window.*exceed/i,
  /maximum.*context.*length/i,
] as const;

export const looksLikeNeedsRetryWithoutResume = (text: string): boolean =>
  RESUME_RETRY_PATTERNS.some((p) => p.test(text));

export const isMissingGrokResumeSession = (data: Record<string, unknown> | undefined): boolean => {
  if (data?.agentType !== 'grok-build' || !isRecord(data.details)) return false;
  const { details } = data;
  const rpcData = details.data;
  return details.method === 'session/load' && isRecord(rpcData) && rpcData.code === 'FS_NOT_FOUND';
};
