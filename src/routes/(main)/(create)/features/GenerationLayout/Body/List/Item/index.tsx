'use client';

import { Icon } from '@lobehub/ui';
import { type MenuProps } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { EyeOffIcon, Trash, UsersIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { type ImageGenerationTopic } from '@/types/generation';

import { useGenerationTopicContext } from '../StoreContext';
import GridItem from './GridItem';
import ListItem from './ListItem';

interface TopicItemProps {
  showMoreInfo?: boolean;
  style?: CSSProperties;
  topic: ImageGenerationTopic;
}

const TopicItem = memo<TopicItemProps>(({ topic, showMoreInfo, style }) => {
  const { useStore, namespace } = useGenerationTopicContext();
  const { t } = useTranslation([namespace, 'common']);
  const { message } = App.useApp();
  const activeWorkspaceId = useActiveWorkspaceId();
  const [isUpdating, setIsUpdating] = useState(false);
  const isLoading = useStore((s) => s.loadingGenerationTopicIds.includes(topic.id));
  const removeGenerationTopic = useStore((s) => s.removeGenerationTopic);
  const setGenerationTopicVisibility = useStore((s) => s.setGenerationTopicVisibility);
  const switchGenerationTopic = useStore((s) => s.switchGenerationTopic);
  const activeTopicId = useStore((s) => s.activeGenerationTopicId);
  const currentUserId = useUserStore(userProfileSelectors.userId);

  // Only the topic's creator sees visibility controls. Backend enforces the same
  // rule via `user_id = ?` guards on `setVisibility`; surfacing the menu entry
  // to non-owners just so the toast can reject it is a footgun — the entry
  // itself is the wrong affordance on someone else's row.
  const isOwnTopic = Boolean(currentUserId && topic.creator?.id === currentUserId);
  const canPublish = Boolean(activeWorkspaceId && isOwnTopic && topic.visibility === 'private');
  const canMakePrivate = Boolean(activeWorkspaceId && isOwnTopic && topic.visibility === 'public');

  const flipVisibility = async (next: 'private' | 'public') => {
    try {
      await setGenerationTopicVisibility(topic.id, next);
      message.success(
        next === 'private'
          ? t('makePrivate.success', { ns: 'common' })
          : t('resources.publishToWorkspace.success', { ns: 'chat' }),
      );
    } catch (error) {
      console.error('Failed to change topic visibility:', error);
      message.error(
        next === 'private'
          ? t('makePrivate.error', { ns: 'common' })
          : t('resources.publishToWorkspace.error', { ns: 'chat' }),
      );
    }
  };

  const isActive = activeTopicId === topic.id;

  const handleClick = () => {
    switchGenerationTopic(topic.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('topic.deleteConfirmDesc'),
      okButtonProps: { danger: true },
      okText: t('delete', { ns: 'common' }),
      onOk: async () => {
        setIsUpdating(true);
        try {
          await removeGenerationTopic(topic.id);
        } catch (error) {
          console.error('Delete topic failed:', error);
        }
        setIsUpdating(false);
      },
      title: t('topic.deleteConfirm'),
    });
  };

  const menuItems: MenuProps['items'] = [
    ...(canPublish
      ? [
          {
            icon: <Icon icon={UsersIcon} />,
            key: 'publishToWorkspace',
            label: t('resources.publishToWorkspace.menu', { ns: 'chat' }),
            onClick: () => {
              confirmModal({
                cancelText: t('cancel', { ns: 'common' }),
                content: <VisibilityConfirmContent variant="publish" />,
                okText: t('continue', { ns: 'common' }),
                title: t('resources.publishToWorkspace.menu', { ns: 'chat' }),
                onOk: () => flipVisibility('public'),
              });
            },
          },
          { type: 'divider' as const },
        ]
      : []),
    ...(canMakePrivate
      ? [
          {
            icon: <Icon icon={EyeOffIcon} />,
            key: 'makePrivate',
            label: t('makePrivate', { ns: 'common' }),
            onClick: () => {
              confirmModal({
                cancelText: t('cancel', { ns: 'common' }),
                content: <VisibilityConfirmContent variant="makePrivate" />,
                okButtonProps: { danger: true },
                okText: t('continue', { ns: 'common' }),
                title: t('makePrivate.confirm.title', { ns: 'common' }),
                onOk: () => flipVisibility('private'),
              });
            },
          },
          { type: 'divider' as const },
        ]
      : []),
    {
      danger: true,
      icon: <Icon icon={Trash} />,
      key: 'delete',
      label: t('delete', { ns: 'common' }),
      onClick: () => {
        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: t('topic.deleteConfirmDesc'),
          okButtonProps: { danger: true },
          okText: t('delete', { ns: 'common' }),
          onOk: async () => {
            try {
              await removeGenerationTopic(topic.id);
            } catch (error) {
              console.error('Delete topic failed:', error);
            }
          },
          title: t('topic.deleteConfirm'),
        });
      },
    },
  ];

  const RenderItem = showMoreInfo ? ListItem : GridItem;

  return (
    <RenderItem
      contextMenuItems={menuItems}
      isActive={isActive}
      isLoading={isLoading}
      isUpdating={isUpdating}
      style={style}
      topic={topic}
      onClick={handleClick}
      onDelete={handleDelete}
    />
  );
});

TopicItem.displayName = 'TopicItem';

export default TopicItem;
