'use client';

import { ActionIcon, Center, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { MessageSquarePlus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { useVisitorTopics } from './useVisitorTopics';

/**
 * The visitor's topic list under the current share (server-scoped by
 * senderId). Selecting a topic drives the chat store's activeTopicId — the
 * same signal the conversation surface and composer key off.
 */
const TopicPanel = memo<{ onSelect?: () => void; shareId: string; showTitle?: boolean }>(
  ({ onSelect, shareId, showTitle = true }) => {
    const { t } = useTranslation('agent');
    const activeTopicId = useChatStore((s) => s.activeTopicId);
    const { data: topics } = useVisitorTopics(shareId);

    const selectTopic = (topicId?: string) => {
      useChatStore.setState({ activeTopicId: topicId }, false, 'AgentShareVisitor/selectTopic');
      onSelect?.();
    };

    return (
      <Flexbox gap={8} height={'100%'} padding={12} style={{ overflowY: 'auto' }}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          {showTitle && (
            <Text fontSize={12} type={'secondary'} weight={500}>
              {t('share.visitor.topics.title')}
            </Text>
          )}
          <ActionIcon
            icon={MessageSquarePlus}
            size={'small'}
            title={t('share.visitor.topics.new')}
            onClick={() => selectTopic(undefined)}
          />
        </Flexbox>
        {!topics?.length ? (
          <Center flex={1}>
            <Text fontSize={12} type={'secondary'}>
              {t('share.visitor.topics.empty')}
            </Text>
          </Center>
        ) : (
          topics.map((topic) => {
            const active = topic.id === activeTopicId;
            return (
              <Flexbox
                key={topic.id}
                paddingBlock={6}
                paddingInline={8}
                style={{
                  background: active ? cssVar.colorFillSecondary : undefined,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
                onClick={() => selectTopic(topic.id)}
              >
                <Text ellipsis fontSize={13}>
                  {topic.title || t('share.visitor.topics.untitled')}
                </Text>
              </Flexbox>
            );
          })
        )}
      </Flexbox>
    );
  },
);

TopicPanel.displayName = 'ShareVisitorTopicPanel';

export default TopicPanel;
