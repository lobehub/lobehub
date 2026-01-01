import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Dropdown } from 'antd';
import { createStaticStyles } from 'antd-style';
import type { ItemType } from 'antd/es/menu/interface';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Clock3Icon, PlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

dayjs.extend(relativeTime);

const styles = createStaticStyles(({ css, cssVar }) => ({
  time: css`
    margin-inline-start: 6px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface TopicSelectorProps {
  agentId: string;
}

const TopicSelector = memo<TopicSelectorProps>(({ agentId }) => {
  const { t } = useTranslation('topic');

  // Fetch topics for the agent builder
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
      (topics || []).map((topic) => {
        const displayTime =
          dayjs().diff(dayjs(topic.updatedAt), 'd') < 7
            ? dayjs(topic.updatedAt).fromNow()
            : dayjs(topic.updatedAt).format('YYYY-MM-DD');

        return {
          key: topic.id,
          label: (
            <Flexbox align="center" gap={4} horizontal justify="space-between" width="100%">
              <span className={styles.title}>{topic.title}</span>
              <span className={styles.time}>{displayTime}</span>
            </Flexbox>
          ),
          onClick: () => switchTopic(topic.id),
        };
      }),
    [topics, switchTopic, styles],
  );

  return (
    <NavHeader
      left={
        activeTopic?.title ? <span className={styles.title}>{activeTopic.title}</span> : undefined
      }
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
              style: { maxHeight: 400, overflowY: 'auto' },
            }}
            overlayStyle={{ minWidth: 280 }}
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
