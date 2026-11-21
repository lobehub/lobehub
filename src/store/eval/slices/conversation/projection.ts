import { defineReplica } from '@/libs/replica';

export interface EvalConversationTopic {
  agentTitle?: string | null;
  id: string;
  title: string | null;
  updatedAt?: Date | number | string | null;
}

/** How many topics the picker lists: the most recent ones, or the best search matches. */
export const CONVERSATION_PICKER_LIMIT = 30;

/** Entry key of a picker query; the empty query lists the recent topics. */
export const conversationPickerKey = ({ query }: { query: string }) => query || '@recent';

/**
 * Topics the case picker offers (`conversationTopicMap[conversationPickerKey]`).
 * Memory only: it is a transient lookup keyed by free text, and the topics
 * themselves are persisted by the chat's own replicas.
 */
export const conversationPickerResource = defineReplica<{ query: string }, EvalConversationTopic[]>(
  {
    key: conversationPickerKey,
    name: 'evalConversationPicker',
    storage: 'memory',
    version: 1,
  },
);
