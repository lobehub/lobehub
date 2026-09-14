import { type DropdownMenuCheckboxItem } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui';
import { ActionIcon, Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Clock3Icon, PlusIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import { useFetchAgentChatTopics } from '@/hooks/useFetchChatTopics';
import { useQueryState } from '@/hooks/useQueryParam';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

const styles = createStaticStyles(({ css }) => ({
  // The tag is a flex item of the header's left slot: without these it keeps its
  // full text width and overlaps the action icons on the right.
  tag: css`
    overflow: hidden;
    min-width: 0;
  `,
  title: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface TopicSelectorProps {
  agentId: string;
  disabled?: boolean;
}

const TopicSelector = memo<TopicSelectorProps>(({ agentId, disabled }) => {
  const { t } = useTranslation('topic');

  // Fetch topics for the group agent builder
  useFetchAgentChatTopics(agentId);

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
          if (disabled) return;
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
      showTogglePanelButton={false}
      styles={{ right: { flex: 'none' } }}
      left={
        activeTopic?.title ? (
          <Tag className={styles.tag}>
            <span className={styles.title} title={activeTopic.title}>
              {activeTopic.title}
            </span>
          </Tag>
        ) : undefined
      }
      right={
        <>
          <ActionIcon
            disabled={disabled}
            icon={PlusIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('actions.addNewTopic')}
            onClick={() => {
              if (disabled) return;

              handleSwitchTopic(undefined);
            }}
          />
          <DropdownMenu
            items={items}
            placement="bottomRight"
            popupProps={{ style: { maxHeight: 600, minWidth: 200, overflowY: 'auto' } }}
            triggerProps={{ disabled: disabled || isEmpty }}
          >
            <ActionIcon
              disabled={disabled || isEmpty}
              icon={Clock3Icon}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            />
          </DropdownMenu>
        </>
      }
    />
  );
});

TopicSelector.displayName = 'TopicSelector';

export default TopicSelector;
