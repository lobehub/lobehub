import { ActionIcon, Flexbox, Popover, Text } from '@lobehub/ui';
import { Clock3Icon, PanelRightCloseIcon, PlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';
import { useGlobalStore } from '@/store/global';

import TopicItem from './TopicSelector/TopicItem';

interface CopilotToolbarProps {
  agentId: string;
}

const CopilotToolbar = memo<CopilotToolbarProps>(({ agentId }) => {
  const { t } = useTranslation('topic');
  const [topicPopoverOpen, setTopicPopoverOpen] = useState(false);

  useChatStore((s) => s.useFetchTopics)(true, { agentId });

  const [activeTopicId, switchTopic, topics] = useChatStore((s) => [
    s.activeTopicId,
    s.switchTopic,
    topicSelectors.currentTopics(s),
  ]);

  const currentTopic = useChatStore(topicSelectors.currentActiveTopic);

  const [toggleRightPanel] = useGlobalStore((s) => [s.toggleRightPanel]);

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
            size={DESKTOP_HEADER_ICON_SIZE}
            title={t('actions.addNewTopic')}
            onClick={() => switchTopic(null, { scope: 'page' })}
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
                      key={topic.id}
                      topicId={topic.id}
                      topicTitle={topic.title}
                      onClose={() => setTopicPopoverOpen(false)}
                      onTopicChange={(id) => switchTopic(id)}
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
                size={DESKTOP_HEADER_ICON_SIZE}
              />
            </Popover>
          )}
          <ActionIcon
            icon={PanelRightCloseIcon}
            size={DESKTOP_HEADER_ICON_SIZE}
            onClick={() => toggleRightPanel()}
          />
        </>
      }
    />
  );
});

CopilotToolbar.displayName = 'CopilotToolbar';

export default CopilotToolbar;
