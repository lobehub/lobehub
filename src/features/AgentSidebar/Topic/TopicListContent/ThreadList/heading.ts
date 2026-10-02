import { ThreadType } from '@lobechat/types';

export type ThreadListHeadingKey =
  'workingPanel.overview.subagents' | 'workingPanel.overview.subtopics';

/** Heading when every listed thread is a subagent. */
export const SUBAGENT_LIST_HEADING: ThreadListHeadingKey = 'workingPanel.overview.subagents';
/** Inclusive heading for a list that also holds non-subagent threads. */
export const THREAD_LIST_HEADING: ThreadListHeadingKey = 'workingPanel.overview.subtopics';

/**
 * Heading key for the right-panel thread list.
 *
 * `getThreadsByTopic` returns subagent (isolation) threads alongside user forks
 * (continuation / standalone), so the list may only be called "Subagents" when
 * every row is one — otherwise the ordinary threads would be mislabelled.
 */
export const getThreadListHeadingKey = (
  threads: readonly { type: string }[],
): ThreadListHeadingKey =>
  threads.every((thread) => thread.type === ThreadType.Isolation)
    ? SUBAGENT_LIST_HEADING
    : THREAD_LIST_HEADING;
