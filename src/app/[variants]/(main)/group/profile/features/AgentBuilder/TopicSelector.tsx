import { ActionIcon, DropdownMenu, type DropdownMenuCheckboxItem, Tag } from '@lobehub/ui';
import { Clock3Icon, PlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

interface TopicSelectorProps {
  agentId: string;
}

const TopicSelector = memo<TopicSelectorProps>(({ agentId }) => {
  const { t } = useTranslation('topic');

  // Fetch topics for the group agent builder
  useChatStore((s) => s.useFetchTopics)(true, { agentId });

  const [activeTopicId, switchTopic, topics] = useChatStore((s) => [
    s.activeTopicId,
    s.switchTopic,
    topicSelectors.getTopicsByAgentId(agentId)(s),
  ]);

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
            switchTopic(topic.id);
          }
        },
        type: 'checkbox',
      })),
    [topics, switchTopic, activeTopicId],
  );
  const isEmpty = !topics || topics.length === 0;

  return (
    <NavHeader
      left={activeTopic?.title ? <Tag>{activeTopic.title}</Tag> : undefined}
      right={
        <>
          <ActionIcon
            icon={PlusIcon}
            onClick={() => switchTopic()}
            size={DESKTOP_HEADER_ICON_SIZE}
            title={t('actions.addNewTopic')}
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
      showTogglePanelButton={false}
    />
  );
});

TopicSelector.displayName = 'TopicSelector';

export default TopicSelector;
