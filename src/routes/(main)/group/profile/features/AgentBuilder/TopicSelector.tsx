import { ActionIcon, type DropdownItem, DropdownMenu, Icon, Tag } from '@lobehub/ui';
import { App } from 'antd';
import { Clock3Icon, MoreHorizontalIcon, PlusIcon, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import { useQueryState } from '@/hooks/useQueryParam';
import { mutate } from '@/libs/swr';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';

interface TopicSelectorProps {
  agentId: string;
  disabled?: boolean;
}

const TopicSelector = memo<TopicSelectorProps>(({ agentId, disabled }) => {
  const { t } = useTranslation(['common', 'topic']);

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

  const { modal } = App.useApp();
  const handleDeleteTopic = useCallback(
    (topicId: string, topicTitle: string) => {
      modal.confirm({
        cancelText: t('cancel', { ns: 'common' }),
        centered: true,
        content: t('actions.confirmRemoveTopic', {
          ns: 'topic',
          title: topicTitle,
        }),
        okButtonProps: { danger: true },
        okText: t('delete', { ns: 'common' }),
        onOk: async () => {
          await topicService.removeTopic(topicId);

          if (activeTopicId === topicId) {
            handleSwitchTopic(undefined);
          }

          const containerKey = topicMapKey({ agentId });
          await mutate(
            (key) =>
              Array.isArray(key) && key[0] === 'SWR_USE_FETCH_TOPIC' && key[1] === containerKey,
            undefined,
            { revalidate: true },
          );
        },
        title: t('delete', { ns: 'common' }),
      });
    },
    [agentId, activeTopicId, handleSwitchTopic, modal, t],
  );

  const items = useMemo<DropdownItem[]>(
    () =>
      (topics || []).map((topic) => {
        const topicActions: DropdownItem[] = [
          {
            danger: true,
            icon: <Icon icon={Trash2} />,
            key: `delete-${topic.id}`,
            label: t('delete', { ns: 'common' }),
            onClick: () => {
              handleDeleteTopic(topic.id, topic.title);
            },
          },
        ];

        return {
          extra: (
            <span
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <DropdownMenu items={topicActions} placement="bottomRight">
                <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
              </DropdownMenu>
            </span>
          ),
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
        };
      }),
    [topics, handleSwitchTopic, activeTopicId, disabled, handleDeleteTopic, t],
  );
  const isEmpty = !topics || topics.length === 0;

  return (
    <NavHeader
      left={activeTopic?.title ? <Tag>{activeTopic.title}</Tag> : undefined}
      showTogglePanelButton={false}
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
            <ActionIcon disabled={disabled || isEmpty} icon={Clock3Icon} />
          </DropdownMenu>
        </>
      }
    />
  );
});

TopicSelector.displayName = 'TopicSelector';

export default TopicSelector;
