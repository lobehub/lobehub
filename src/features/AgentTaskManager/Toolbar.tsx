import { ActionIcon, Flexbox, Popover, Text } from '@lobehub/ui';
import { Clock3Icon, PanelRightCloseIcon, PlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { TASK_MANAGER_INCLUDE_TRIGGERS } from '@/const/topic';
import { conversationSelectors, useConversationStore } from '@/features/Conversation';
import NavHeader from '@/features/NavHeader';
import TopicItem from '@/features/PageEditor/Copilot/TopicSelector/TopicItem';
import { useGlobalStore } from '@/store/global';
import { useTaskChatStore } from '@/store/taskChat';

const Toolbar = memo(() => {
  const { t } = useTranslation('topic');
  const [topicPopoverOpen, setTopicPopoverOpen] = useState(false);
  const agentId = useConversationStore(conversationSelectors.agentId);

  useTaskChatStore((s) => s.useFetchTopics)(agentId, TASK_MANAGER_INCLUDE_TRIGGERS);

  const [activeTopicId, switchTopic] = useTaskChatStore((s) => [s.activeTopicId, s.switchTopic]);
  const topics = useTaskChatStore((s) => s.topics);

  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);

  const isLoadingTopics = topics === undefined;
  const topicTitle = topics?.find((topic) => topic.id === activeTopicId)?.title || t('title');
  const hasTopics = !!topics && topics.length > 0;

  const handleCreate = () => {
    switchTopic(null);
  };

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
            onClick={handleCreate}
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
                      onDelete={(deletedId) => {
                        const store = useTaskChatStore.getState();
                        void store.refreshTopics();
                        if (store.activeTopicId === deletedId) store.switchTopic(null);
                      }}
                    />
                  ))}
                </Flexbox>
              ) : (
                <Flexbox padding={16}>
                  <Text type={'secondary'}>{t('temp')}</Text>
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
              size={DESKTOP_HEADER_ICON_SIZE}
            />
          </Popover>
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

Toolbar.displayName = 'Toolbar';

export default Toolbar;
