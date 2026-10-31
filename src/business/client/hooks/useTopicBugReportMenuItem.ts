import type { DropdownItem } from '@lobehub/ui';

/** The topic a report is about, as the conversation header knows it. */
export interface TopicBugReportTarget {
  agentId?: string;
  threadId?: string;
  topicId?: string;
}

/**
 * "Report a problem" in the topic menu, which submits where the topic is to a
 * support inbox. Nothing by default: only a deployment with such an inbox can
 * act on it.
 */
export const useTopicBugReportMenuItem = (_target: TopicBugReportTarget): DropdownItem | null =>
  null;
