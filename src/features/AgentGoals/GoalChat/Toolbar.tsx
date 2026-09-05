import { Flexbox, Popover } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { Clock3Icon, PanelRightCloseIcon, PlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { conversationSelectors, useConversationStore } from '@/features/Conversation';
import NavHeader from '@/features/NavHeader';
import TopicItem from '@/features/PageEditor/Copilot/TopicSelector/TopicItem';
import { useFetchAgentChatTopics } from '@/hooks/useFetchChatTopics';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

interface ToolbarProps {
  onCollapse: () => void;
}

/** Topic title + new-conversation + history — the agent's conversation list. */
const Toolbar = memo<ToolbarProps>(({ onCollapse }) => {
  const { t } = useTranslation('chat');
  const [topicPopoverOpen, setTopicPopoverOpen] = useState(false);
  const agentId = useConversationStore(conversationSelectors.agentId);

  useFetchAgentChatTopics(agentId);

  const [activeTopicId, switchTopic, topics] = useChatStore((s) => [
    s.activeTopicId,
    s.switchTopic,
    topicSelectors.currentTopics(s),
  ]);
  const currentTopic = useChatStore(topicSelectors.currentActiveTopic);

  const isLoadingTopics = topics === undefined;
  const topicTitle = currentTopic?.title || t('goalChat.title');
  const hasTopics = !!topics && topics.length > 0;

  return (
    <NavHeader
      showTogglePanelButton={false}
      left={
        <Text
          style={{ fontSize: 13, fontWeight: 500, marginLeft: 8 }}
          type={'secondary'}
          ellipsis={{
            tooltipWhenOverflow: true,
          }}
        >
          {topicTitle}
        </Text>
      }
      right={
        <>
          <ActionIcon
            icon={PlusIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('goalChat.newTopic')}
            onClick={() => switchTopic(null)}
          />
          <Popover
            open={isLoadingTopics ? false : topicPopoverOpen}
            placement="bottomRight"
            trigger="click"
            content={
              hasTopics ? (
                <Flexbox
                  gap={4}
                  padding={8}
                  style={{
                    maxHeight: '50vh',
                    overflowY: 'auto',
                    width: '100%',
                  }}
                >
                  {topics!.map((topic) => (
                    <TopicItem
                      active={topic.id === activeTopicId}
                      key={topic.id}
                      topicId={topic.id}
                      topicTitle={topic.title}
                      onClose={() => setTopicPopoverOpen(false)}
                      onTopicChange={(id) => switchTopic(id)}
                    />
                  ))}
                </Flexbox>
              ) : (
                <Flexbox padding={16}>
                  <Text type={'secondary'}>{t('goalChat.noTopics')}</Text>
                </Flexbox>
              )
            }
            styles={{
              content: {
                padding: 0,
                width: 240,
              },
            }}
            onOpenChange={setTopicPopoverOpen}
          >
            <ActionIcon
              disabled={isLoadingTopics}
              icon={Clock3Icon}
              loading={isLoadingTopics}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            />
          </Popover>
          <ActionIcon
            icon={PanelRightCloseIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            onClick={onCollapse}
          />
        </>
      }
    />
  );
});

Toolbar.displayName = 'GoalChatToolbar';

export default Toolbar;
