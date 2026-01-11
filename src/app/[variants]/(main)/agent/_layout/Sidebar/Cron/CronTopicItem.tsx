'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import TopicItem from '../Topic/List/Item';

interface CronTopicItemProps {
  topic: {
    createdAt: Date | string;
    favorite?: boolean | null;
    historySummary?: string | null;
    id: string;
    metadata?: any;
    title?: string | null;
    trigger?: string | null;
    updatedAt: Date | string;
  };
}

const CronTopicItem = memo<CronTopicItemProps>(({ topic }) => {
  const { t } = useTranslation('topic');
  const [activeTopicId, activeThreadId] = useChatStore((s) => [s.activeTopicId, s.activeThreadId]);

  const displayTitle = topic.title || topic.historySummary || t('defaultTitle');

  return (
    <TopicItem
      active={activeTopicId === topic.id}
      fav={!!topic.favorite}
      id={topic.id}
      threadId={activeThreadId}
      title={displayTitle}
    />
  );
});

export default CronTopicItem;
