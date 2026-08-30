import { Flexbox, Popover } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { Clock3Icon, PanelRightCloseIcon, PlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { conversationSelectors, useConversationStore } from '@/features/Conversation';
import NavHeader from '@/features/NavHeader';
import { useFetchAgentTopics } from '@/hooks/useFetchAgentTopics';
import { useChatStore } from '@/store/chat';
import { useChatTopicById, useChatTopicsByAgentId } from '@/store/chat/slices/topic/projection';

import { usePageAgentPanelControl, usePageAgentPanelOverride } from '../RightPanel/OverrideContext';
import TopicItem from './TopicSelector/TopicItem';

interface CopilotToolbarProps {
  onTopicChange?: (topicId: string | null) => void;
  topicId?: string | null;
}

const CopilotToolbar = memo<CopilotToolbarProps>(({ onTopicChange, topicId }) => {
  const { t } = useTranslation('topic');
  const [topicPopoverOpen, setTopicPopoverOpen] = useState(false);
  const agentId = useConversationStore(conversationSelectors.agentId);

  useFetchAgentTopics({ agentId });

  const [globalActiveTopicId, switchTopic] = useChatStore((s) => [s.activeTopicId, s.switchTopic]);

  const activeTopicId = topicId === undefined ? globalActiveTopicId : topicId;
  const topics = useChatTopicsByAgentId(agentId)?.items;
  const currentTopic = useChatTopicById(activeTopicId ?? undefined);

  const { toggle: togglePageAgentPanel } = usePageAgentPanelControl();
  const hasOverride = !!usePageAgentPanelOverride();

  const isLoadingTopics = topics === undefined;
  const hideHistory = !isLoadingTopics && topics.length === 0;

  const topicTitle = currentTopic?.title || t('title');

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
            title={t('actions.addNewTopic')}
            onClick={() =>
              onTopicChange ? onTopicChange(null) : switchTopic(null, { scope: 'page' })
            }
          />
          {!hideHistory && (
            <Popover
              open={isLoadingTopics ? false : topicPopoverOpen}
              placement="bottomRight"
              trigger="click"
              content={
                <Flexbox
                  gap={4}
                  padding={8}
                  style={{
                    maxHeight: '50vh',
                    overflowY: 'auto',
                    width: '100%',
                  }}
                >
                  {(topics || []).map((topic) => (
                    <TopicItem
                      active={topic.id === activeTopicId}
                      agentId={agentId}
                      fav={topic.favorite}
                      key={topic.id}
                      status={topic.status}
                      topicId={topic.id}
                      topicTitle={topic.title}
                      onClose={() => setTopicPopoverOpen(false)}
                      onTopicChange={(id) => (onTopicChange ? onTopicChange(id) : switchTopic(id))}
                    />
                  ))}
                </Flexbox>
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
          )}
          {!hasOverride && (
            <ActionIcon
              icon={PanelRightCloseIcon}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              onClick={() => togglePageAgentPanel()}
            />
          )}
        </>
      }
    />
  );
});

CopilotToolbar.displayName = 'CopilotToolbar';

export default CopilotToolbar;
