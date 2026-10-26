import { useEffect } from 'react';

import { revalidateReplica } from '@/libs/replica';
import { useChatStore } from '@/store/chat';
import {
  type ProjectTopic,
  projectTopicsResource,
} from '@/store/projectWorkingDirectory/projection';

/**
 * Clear the unread mark of the project conversation being read.
 *
 * The Agent route clears it through `switchTopic` and `useClearActiveTopicUnread`,
 * which both read the status from the chat store's `topicDataMap`. A project
 * lists its conversations in its own replica, so neither sees the topic and a
 * finished run stayed under "pending" while the user was reading it. This reads
 * the status from the project row and refreshes the rows once the write lands.
 */
export const useMarkProjectTopicRead = (projectId?: string, topic?: ProjectTopic) => {
  const markTopicRead = useChatStore((s) => s.markTopicRead);
  const topicId = topic?.id;
  const agentId = topic?.agentId ?? undefined;
  const isUnread = topic?.status === 'unread';

  useEffect(() => {
    if (!projectId || !topicId || !isUnread) return;

    void markTopicRead({ agentId, status: 'unread', topicId }).then(() =>
      revalidateReplica(projectTopicsResource, projectId),
    );
  }, [agentId, isUnread, markTopicRead, projectId, topicId]);
};
