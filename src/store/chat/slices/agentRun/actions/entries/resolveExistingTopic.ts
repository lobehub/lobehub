import type { ChatTopic } from '@/types/topic';

import { ensureOwnedWorktreeForRun } from './ownedWorktreeRestore';

/**
 * Resolve the topic row a run should read its metadata from.
 *
 * The topic list store is PAGINATED (`topicDataMap[key].items` holds only the
 * loaded pages), so a deep-linked older topic misses `getTopicById` even while
 * it is the ACTIVE topic. For heterogeneous CLI runs that miss used to cascade
 * silently: the cwd resolution fell back to the agent/device default directory
 * instead of the topic's bound `workingDirectory`, `resolveHeteroResume` then
 * saw no metadata and dropped `--resume`, and every turn started a brand-new
 * CLI session with no history — no error anywhere.
 *
 * Store row wins when present (it may carry fresher optimistic edits). On a
 * miss for a hetero run, fall back to the server row. Fetch failures degrade
 * to the old behavior rather than blocking the turn.
 */
export const resolveExistingTopicForRun = async (params: {
  /**
   * Bring back the worktree the app created for a restored topic before the
   * turn runs in it (see `ensureOwnedWorktreeForRun`); injectable for tests.
   */
  ensureWorktree?: (topic: ChatTopic | undefined) => Promise<ChatTopic | undefined>;
  fetchTopicDetail: (id: string) => Promise<ChatTopic | null>;
  /** Only hetero runs consume topic-bound cwd/session metadata — skip the round-trip otherwise. */
  isHetero: boolean;
  storeTopic: ChatTopic | undefined;
  topicId: string | null | undefined;
}): Promise<ChatTopic | undefined> => {
  const {
    ensureWorktree = ensureOwnedWorktreeForRun,
    fetchTopicDetail,
    isHetero,
    storeTopic,
    topicId,
  } = params;
  if (storeTopic) return ensureWorktree(storeTopic);
  if (!topicId || !isHetero) return undefined;
  try {
    return await ensureWorktree((await fetchTopicDetail(topicId)) ?? undefined);
  } catch (error) {
    console.error('[resolveExistingTopicForRun] Failed to fetch topic detail:', error);
    return undefined;
  }
};
