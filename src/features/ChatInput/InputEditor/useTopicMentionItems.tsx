import { Icon } from '@lobehub/ui';
import { MessageSquareText } from 'lucide-react';
import { useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useTopicMentionItems = () => {
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);

  const topicsSelector = useMemo(
    () => topicSelectors.displayTopicsForSidebar(topicPageSize),
    [topicPageSize],
  );
  const topics = useChatStore(topicsSelector);
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  return useMemo(() => {
    if (!topics || topics.length === 0) return [];

    const MAX_LABEL_LENGTH = 50;

    return topics
      .filter((t) => t.id !== activeTopicId)
      .map((topic) => {
        const title = topic.title || 'Untitled';
        const label =
          title.length > MAX_LABEL_LENGTH ? `${title.slice(0, MAX_LABEL_LENGTH)}...` : title;

        return {
          icon: <Icon icon={MessageSquareText} size={20} />,
          key: `topic-${topic.id}`,
          label,
          metadata: { topicId: topic.id, topicTitle: topic.title, type: 'topic' },
        };
      });
  }, [topics, activeTopicId]);
};
