import { type DropdownMenuCheckboxItem } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
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
  const useFetchTopics = useChatStore((s) => s.useFetchTopics);

  useFetchTopics(true, { agentId });

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
      (topics || []).map((topic) => {
        const displayTime =
          dayjs().diff(dayjs(topic.updatedAt), 'd') < 7
            ? dayjs(topic.updatedAt).fromNow()
            : dayjs(topic.updatedAt).format('YYYY-MM-DD');

        return {
          checked: topic.id === activeTopicId,
          closeOnClick: true,
          key: topic.id,
          label: (
            <Flexbox horizontal align="center" gap={4} justify="space-between" width="100%">
              <span className={styles.title}>{topic.title}</span>
              <span className={styles.time}>{displayTime}</span>
            </Flexbox>
          ),
          onCheckedChange: (checked) => {
            if (checked) {
              switchTopic(topic.id);
            }
          },
          type: 'checkbox',
        };
      }),
    [topics, switchTopic, styles, activeTopicId],
  );
  const isEmpty = !topics || topics.length === 0;

  return (
    <NavHeader
      showTogglePanelButton={false}
      left={
        activeTopic?.title ? <span className={styles.title}>{activeTopic.title}</span> : undefined
      }
      right={
        <>
          <ActionIcon
            icon={PlusIcon}
            size={DESKTOP_HEADER_ICON_SIZE}
            title={t('actions.addNewTopic')}
            onClick={() => switchTopic()}
          />
          <DropdownMenu
            items={items}
            placement="bottomRight"
            popupProps={{ style: { maxHeight: 400, minWidth: 280, overflowY: 'auto' } }}
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
