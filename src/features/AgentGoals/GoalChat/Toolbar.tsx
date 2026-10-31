import { ActionIcon, Flexbox, Popover, Text } from '@lobehub/ui';
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

import TopicActions from './TopicActions';

interface ToolbarProps {
  /** Shown while the open conversation has no titled topic. @default the side chat's title */
  fallbackTitle?: string;
  onCollapse: () => void;
  /**
   * The conversation is bound to the goal (its supervision record): no new
   * conversation and no history, so the panel can never leave that topic.
   */
  topicLocked?: boolean;
}

/**
 * Topic title + topic menu, then new-conversation + history — laid out like the
 * agent conversation header. Shared by the side chat and the supervision record
 * so both goal-page conversations carry the same header; the record locks it to
 * its topic.
 */
const Toolbar = memo<ToolbarProps>(({ fallbackTitle, onCollapse, topicLocked }) => {
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
  const topicTitle = currentTopic?.title || fallbackTitle || t('goalChat.title');
  const hasTopics = !!topics && topics.length > 0;

  return (
    <NavHeader
      showTogglePanelButton={false}
      left={
        <Flexbox allowShrink horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
          <Text
            ellipsis={{ tooltipWhenOverflow: true }}
            style={{ fontSize: 14, fontWeight: 600, marginLeft: 8, minWidth: 0 }}
          >
            {topicTitle}
          </Text>
          {agentId && currentTopic && (
            <TopicActions
              agentId={agentId}
              fav={currentTopic.favorite}
              status={currentTopic.status}
              topicId={currentTopic.id}
              topicLocked={topicLocked}
              topicTitle={currentTopic.title}
            />
          )}
        </Flexbox>
      }
      right={
        <>
          {!topicLocked && (
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
                          agentId={agentId}
                          fav={topic.favorite}
                          key={topic.id}
                          status={topic.status}
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
            </>
          )}
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
