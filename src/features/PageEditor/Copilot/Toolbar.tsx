import { Flexbox, Popover } from '@lobehub/ui';
import { ActionIcon, Tabs, Text } from '@lobehub/ui/base-ui';
import { Clock3Icon, PanelRightCloseIcon, PlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { conversationSelectors, useConversationStore } from '@/features/Conversation';
import NavHeader from '@/features/NavHeader';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

import { usePageAgentPanelControl, usePageAgentPanelOverride } from '../RightPanel/OverrideContext';
import TopicItem from './TopicSelector/TopicItem';

export type CopilotPanelTab = 'annotations' | 'topic';

interface CopilotToolbarProps {
  activeTab?: CopilotPanelTab;
  onTabChange?: (tab: CopilotPanelTab) => void;
  onTopicChange?: (topicId: string | null) => void;
  topicId?: string | null;
}

const CopilotToolbar = memo<CopilotToolbarProps>(
  ({ activeTab = 'topic', onTabChange, onTopicChange, topicId }) => {
    const { t } = useTranslation(['topic', 'editor']);
    const [topicPopoverOpen, setTopicPopoverOpen] = useState(false);
    const agentId = useConversationStore(conversationSelectors.agentId);

    useChatStore((s) => s.useFetchTopics)(true, { agentId });

    const [globalActiveTopicId, switchTopic, topics] = useChatStore((s) => [
      s.activeTopicId,
      s.switchTopic,
      topicSelectors.getTopicsByAgentId(agentId)(s),
    ]);
    const activeTopicId = topicId === undefined ? globalActiveTopicId : topicId;
    const currentTopic = topics?.find((topic) => topic.id === activeTopicId);
    const topicTitle = currentTopic?.title || t('title');

    const { toggle: togglePageAgentPanel } = usePageAgentPanelControl();
    const hasOverride = !!usePageAgentPanelOverride();

    const isLoadingTopics = topics === undefined;
    const hideHistory = !isLoadingTopics && topics.length === 0;

    return (
      <NavHeader
        showTogglePanelButton={false}
        left={
          onTabChange ? (
            <Tabs
              activeKey={activeTab}
              size="small"
              variant="point"
              items={[
                { key: 'topic', label: t('copilot.tabs.topic', { ns: 'editor' }) },
                { key: 'annotations', label: t('copilot.tabs.annotations', { ns: 'editor' }) },
              ]}
              onChange={(key) => onTabChange(key as CopilotPanelTab)}
            />
          ) : (
            <Text
              ellipsis={{ tooltipWhenOverflow: true }}
              style={{ fontSize: 13, fontWeight: 500, marginLeft: 8 }}
              type="secondary"
            >
              {topicTitle}
            </Text>
          )
        }
        right={
          <>
            {activeTab === 'topic' && (
              <ActionIcon
                icon={PlusIcon}
                size={DESKTOP_HEADER_ICON_SMALL_SIZE}
                title={t('actions.addNewTopic')}
                onClick={() =>
                  onTopicChange ? onTopicChange(null) : switchTopic(null, { scope: 'page' })
                }
              />
            )}
            {activeTab === 'topic' && !hideHistory && (
              <Popover
                open={isLoadingTopics ? false : topicPopoverOpen}
                placement="bottomRight"
                styles={{ content: { padding: 0, width: 240 } }}
                trigger="click"
                content={
                  <Flexbox
                    gap={4}
                    padding={8}
                    style={{ maxHeight: '50vh', overflowY: 'auto', width: '100%' }}
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
                        onTopicChange={(id) =>
                          onTopicChange ? onTopicChange(id) : switchTopic(id)
                        }
                      />
                    ))}
                  </Flexbox>
                }
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
  },
);

CopilotToolbar.displayName = 'CopilotToolbar';

export default CopilotToolbar;
