import { ActionIcon, Tag } from '@lobehub/ui';
import { Dropdown } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
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

  const items = useMemo<ItemType[]>(
    () =>
      (topics || []).map((topic) => ({
        key: topic.id,
        label: topic.title,
        onClick: () => switchTopic(topic.id),
      })),
    [topics, t, switchTopic],
  );

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
          <Dropdown
            disabled={!topics || topics.length === 0}
            menu={{
              items,
              selectedKeys: activeTopicId ? [activeTopicId] : [],
            }}
            overlayStyle={{
              maxHeight: 600,
              minWidth: 200,
              overflowY: 'auto',
            }}
            placement="bottomRight"
            trigger={['click']}
          >
            <ActionIcon disabled={!topics || topics.length === 0} icon={Clock3Icon} />
          </Dropdown>
        </>
      }
      showTogglePanelButton={false}
    />
  );
});

TopicSelector.displayName = 'TopicSelector';

export default TopicSelector;
