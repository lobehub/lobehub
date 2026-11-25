import { topicSelectors } from '@/store/chat/selectors';
import { type ChatStore } from '@/store/chat/store';

/**
 * What a send into an existing topic does to the topic once the server
 * accepted it.
 *
 * - Optimistically bumps the sort key (`sortUpdatedAt`, the sidebar's
 *   activity-time sort/group key) so the topic jumps to the top before the SWR
 *   refetch returns the server's fresh `topicActivityAt`. Bumping `updatedAt`
 *   would no longer reorder anything.
 * - Refetches a project conversation: the Project tool's `switchRunner` may
 *   have left a move pending, which the server applies as this turn starts,
 *   so the folder and device shown would otherwise stay on the old runner.
 *   The tool ran on the server, so this tab's copy of the topic may not show
 *   the pending move yet — any project topic is refetched, not only one
 *   already marked pending.
 */
export const settleExistingTopicAfterSend = (get: () => ChatStore, topicId: string) => {
  const state = get();
  const topic = topicSelectors.getTopicById(topicId)(state);
  const mayMove = !!topic?.projectId || !!topic?.metadata?.pendingProjectWorkingDirectoryId;
  state.internal_dispatchTopic({
    id: topicId,
    type: 'updateTopic',
    value: { sortUpdatedAt: Date.now() },
  });
  if (mayMove) void Promise.resolve(state.refreshTopic()).catch(console.error);
};
