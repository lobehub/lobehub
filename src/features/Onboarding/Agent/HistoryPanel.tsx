'use client';

import { Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatTopic } from '@/types/topic';

import { getOnboardingHistoryTopics } from './history';

interface HistoryPanelProps {
  activeTopicId: string;
  onSelectTopic: (topicId: string) => void;
  selectedTopicId: string;
  topics: ChatTopic[];
}

const formatUpdatedAt = (updatedAt: ChatTopic['updatedAt']) => new Date(updatedAt).toLocaleString();

const HistoryPanel = memo<HistoryPanelProps>(
  ({ activeTopicId, onSelectTopic, selectedTopicId, topics }) => {
    const { t } = useTranslation('onboarding');
    const historyTopics = useMemo(() => getOnboardingHistoryTopics(topics), [topics]);

    return (
      <Flexbox gap={8}>
        <Flexbox gap={8}>
          {historyTopics.map((topic) => {
            const isCurrentTopic = topic.id === activeTopicId;
            const isSelectedTopic = topic.id === selectedTopicId;

            return (
              <Button
                block
                key={topic.id}
                size={'small'}
                style={{ height: 'auto', paddingBlock: 10 }}
                type={isSelectedTopic ? 'primary' : 'default'}
                onClick={() => onSelectTopic(topic.id)}
              >
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={8}
                  justify={'space-between'}
                  width={'100%'}
                >
                  <Flexbox align={'flex-start'} gap={2} style={{ overflow: 'hidden' }}>
                    <Text
                      ellipsis={{ rows: 1, tooltip: topic.title }}
                      style={{ maxWidth: '100%' }}
                      weight={500}
                    >
                      {topic.title}
                    </Text>
                    <Text as={'time'} fontSize={12} type={'secondary'}>
                      {formatUpdatedAt(topic.updatedAt)}
                    </Text>
                  </Flexbox>
                  {isCurrentTopic && <Tag variant={'borderless'}>{t('agent.history.current')}</Tag>}
                </Flexbox>
              </Button>
            );
          })}
        </Flexbox>
      </Flexbox>
    );
  },
);

HistoryPanel.displayName = 'HistoryPanel';

export default HistoryPanel;
