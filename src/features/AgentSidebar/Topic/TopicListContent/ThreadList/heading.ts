import { type ThreadMetadata } from '@lobechat/types';

import { isSubagentThread } from './subagent';

export type ThreadListHeadingKey =
  'workingPanel.overview.subagents' | 'workingPanel.overview.subtopics';

/** Heading when every listed thread is a subagent. */
export const SUBAGENT_LIST_HEADING: ThreadListHeadingKey = 'workingPanel.overview.subagents';
/** Inclusive heading for a list that also holds non-subagent threads. */
export const THREAD_LIST_HEADING: ThreadListHeadingKey = 'workingPanel.overview.subtopics';

/**
 * Heading key for the right-panel thread list.
 *
 * A topic's list mixes tool-spawned subagents with ordinary threads (a direct
 * `@Agent` isolation thread, a user fork), so the list may only be called
 * "Subagents" when every row is one — otherwise those threads would be
 * mislabelled. Subagent-ness comes from `metadata.sourceToolCallId`, the same
 * marker the thread portal uses.
 */
export const getThreadListHeadingKey = (
  threads: readonly { metadata?: null | ThreadMetadata }[],
): ThreadListHeadingKey =>
  threads.length > 0 && threads.every(isSubagentThread)
    ? SUBAGENT_LIST_HEADING
    : THREAD_LIST_HEADING;
