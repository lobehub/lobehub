import type { ThreadItem } from '@lobechat/types';

// Shared by local Desktop and authenticated device dispatch so recovery uses the same ancestry rules.
export {
  type CodexBranchRun,
  resolveCodexBranchRun,
  resolveCodexForkTarget,
} from '@lobechat/heterogeneous-agents';

/**
 * Finds the cached Codex Fork thread a run belongs to.
 *
 * Use when:
 * - Deciding whether a thread-scoped run owns its native session, working directory and
 *   dispatch error handling, instead of sharing them with its topic.
 * Expects:
 * - The chat store's `threadMaps` and the run's topic/thread identifiers.
 * Returns:
 * - The thread only when it carries an immutable `codexForkTarget`; every other thread
 *   (including ordinary branches of other agents) keeps the topic-scoped behavior.
 */
export const findCodexForkThread = (
  threadMaps: Record<string, ThreadItem[] | undefined> | undefined,
  topicId: string | null | undefined,
  threadId: string | null | undefined,
): ThreadItem | undefined => {
  if (!topicId || !threadId) return;
  const thread = threadMaps?.[topicId]?.find((item) => item.id === threadId);
  return thread?.metadata?.codexForkTarget ? thread : undefined;
};
