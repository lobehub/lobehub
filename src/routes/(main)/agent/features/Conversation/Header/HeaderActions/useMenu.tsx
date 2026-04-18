'use client';

import { type DropdownItem, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { Copy, Hash, Maximize2, PencilLine, Star, Trash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useMenu = (): { menuItems: DropdownItem[] } => {
  const { t } = useTranslation(['chat', 'topic', 'common']);
  const { modal, message } = App.useApp();

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);

  const activeTopic = useChatStore(topicSelectors.currentActiveTopic);
  const workingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const [favoriteTopic, removeTopic] = useChatStore((s) => [s.favoriteTopic, s.removeTopic]);

  const topicId = activeTopic?.id;
  const isFavorite = !!activeTopic?.favorite;

  const menuItems = useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [];

    if (topicId) {
      items.push(
        {
          icon: <Icon icon={Star} />,
          key: 'favorite',
          label: t(isFavorite ? 'actions.unfavorite' : 'actions.favorite', { ns: 'topic' }),
          onClick: () => {
            favoriteTopic(topicId, !isFavorite);
          },
        },
        {
          icon: <Icon icon={PencilLine} />,
          key: 'rename',
          label: t('rename', { ns: 'common' }),
          onClick: () => {
            useChatStore.setState({ topicRenamingId: topicId });
          },
        },
        { type: 'divider' as const },
      );

      if (isDesktop && workingDirectory) {
        items.push({
          icon: <Icon icon={Copy} />,
          key: 'copyWorkingDirectory',
          label: t('actions.copyWorkingDirectory', { ns: 'topic' }),
          onClick: () => {
            void navigator.clipboard.writeText(workingDirectory);
            message.success(t('actions.copyWorkingDirectorySuccess', { ns: 'topic' }));
          },
        });
      }

      items.push(
        {
          icon: <Icon icon={Hash} />,
          key: 'copySessionId',
          label: t('actions.copySessionId', { ns: 'topic' }),
          onClick: () => {
            void navigator.clipboard.writeText(topicId);
            message.success(t('actions.copySessionIdSuccess', { ns: 'topic' }));
          },
        },
        { type: 'divider' as const },
      );
    }

    items.push({
      checked: wideScreen,
      icon: <Icon icon={Maximize2} />,
      key: 'full-width',
      label: t('viewMode.fullWidth'),
      onCheckedChange: toggleWideScreen,
      type: 'switch',
    });

    if (topicId) {
      items.push(
        { type: 'divider' as const },
        {
          danger: true,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: () => {
            modal.confirm({
              centered: true,
              okButtonProps: { danger: true },
              onOk: async () => {
                await removeTopic(topicId);
              },
              title: t('actions.confirmRemoveTopic', { ns: 'topic' }),
            });
          },
        },
      );
    }

    return items;
  }, [
    topicId,
    isFavorite,
    workingDirectory,
    wideScreen,
    favoriteTopic,
    removeTopic,
    toggleWideScreen,
    t,
    modal,
    message,
  ]);

  return { menuItems };
};
