import type { ReplyTopic } from './ReplyTopicPanel';

/**
 * The reply topic shown beside the Channel. A thread, as the page or beside the Channel, the
 * member list or a portal view (report, web page) replaces it; it belongs to the Channel it was opened from.
 */
export const openTopic = (
  topic: (ReplyTopic & { channelId: string }) | null,
  channelId: string | undefined,
  covered: { members: boolean; portal: boolean; thread: boolean },
) =>
  topic?.channelId === channelId && !covered.thread && !covered.members && !covered.portal
    ? topic
    : null;
