import type { UIChatMessage } from '@lobechat/types';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface ThreadTranscriptTarget {
  agentId: string;
  threadId: string;
  topicId?: string | null;
}

/**
 * The live transcript of a direct @Agent thread. A run this tab drives itself
 * (no Gateway) writes it under the sub-agent scope; a Gateway run streams into
 * the thread scope.
 */
export const selectThreadTranscript =
  ({ agentId, threadId, topicId }: ThreadTranscriptTarget) =>
  (state: { dbMessagesMap: Record<string, UIChatMessage[] | undefined> }) =>
    state.dbMessagesMap[
      messageMapKey({ agentId, scope: 'sub_agent', subAgentId: agentId, threadId, topicId })
    ] ?? state.dbMessagesMap[messageMapKey({ agentId, scope: 'thread', threadId, topicId })];
