import { type DropdownMenuCheckboxItem } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Tag } from '@lobehub/ui';
import { Clock3Icon, PlusIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import { useQueryState } from '@/hooks/useQueryParam';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

interface TopicSelectorProps {
  agentId: string;
}

const TopicSelector = memo<TopicSelectorProps>(({ agentId }) => {
  const { t } = useTranslation('topic');

  // Fetch topics for the group agent builder
  useChatStore((s) => s.useFetchTopics)(true, { agentId });

  // Use activeTopicId from chatStore (synced from URL query 'bt' via ProfileHydration)
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const topics = useChatStore((s) => topicSelectors.getTopicsByAgentId(agentId)(s));

  // Directly update URL query 'bt' to switch topic in profile page
  const [, setBuilderTopicId] = useQueryState('bt');

  const handleSwitchTopic = useCallback(
    (topicId?: string) => {
      setBuilderTopicId(topicId ?? null);
    },
    [setBuilderTopicId],
  );

  // Find active topic from the agent's topics list directly
  const activeTopic = useMemo(
    () => topics?.find((topic) => topic.id === activeTopicId),
    [topics, activeTopicId],
  );

  const items = useMemo<DropdownMenuCheckboxItem[]>(
    () =>
      (topics || []).map((topic) => ({
        checked: topic.id === activeTopicId,
        closeOnClick: true,
        key: topic.id,
        label: topic.title,
        onCheckedChange: (checked) => {
          if (checked) {
            handleSwitchTopic(topic.id);
          }
        },
        type: 'checkbox',
      })),
    [topics, handleSwitchTopic, activeTopicId],
  );
  const isEmpty = !topics || topics.length === 0;

  return (
    <NavHeader
      left={activeTopic?.title ? <Tag>{activeTopic.title}</Tag> : undefined}
      showTogglePanelButton={false}
      right={
        <>
          <ActionIcon
            icon={PlusIcon}
            size={DESKTOP_HEADER_ICON_SIZE}
            title={t('actions.addNewTopic')}
            onClick={() => handleSwitchTopic(undefined)}
          />
          <DropdownMenu
            items={items}
            placement="bottomRight"
            popupProps={{ style: { maxHeight: 600, minWidth: 200, overflowY: 'auto' } }}
            triggerProps={{ disabled: isEmpty }}
          >
            <ActionIcon disabled={isEmpty} icon={Clock3Icon} />
          </DropdownMenu>
        </>
      }
    />
  );
});

TopicSelector.displayName = 'TopicSelector';

export default TopicSelector;
