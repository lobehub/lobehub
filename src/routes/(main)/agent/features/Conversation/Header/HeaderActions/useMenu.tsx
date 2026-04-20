'use client';

import { type DropdownItem, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { Copy, ExternalLink, Hash, Maximize2, PencilLine, Star, Trash, Wand2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { openRenameModal } from '@/components/RenameModal';
import { isDesktop } from '@/const/version';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useMenu = (): { menuItems: DropdownItem[] } => {
  const { t } = useTranslation(['chat', 'topic', 'common']);
  const { modal, message } = App.useApp();
  const { pathname } = useLocation();

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);
  const openTopicInNewWindow = useGlobalStore((s) => s.openTopicInNewWindow);

  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const activeTopic = useChatStore(topicSelectors.currentActiveTopic);
  const workingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const [autoRenameTopicTitle, favoriteTopic, removeTopic, updateTopicTitle] = useChatStore((s) => [
    s.autoRenameTopicTitle,
    s.favoriteTopic,
    s.removeTopic,
    s.updateTopicTitle,
  ]);

  const topicId = activeTopic?.id;
  const topicTitle = activeTopic?.title ?? '';
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
        { type: 'divider' as const },
        {
          icon: <Icon icon={Wand2} />,
          key: 'autoRename',
          label: t('actions.autoRename', { ns: 'topic' }),
          onClick: () => {
            autoRenameTopicTitle(topicId);
          },
        },
        {
          icon: <Icon icon={PencilLine} />,
          key: 'rename',
          label: t('rename', { ns: 'common' }),
          onClick: () => {
            openRenameModal({
              defaultValue: topicTitle,
              description: t('renameModal.description', { ns: 'topic' }),
              onSave: async (newTitle) => {
                await updateTopicTitle(topicId, newTitle);
              },
              title: t('renameModal.title', { ns: 'topic' }),
            });
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

      if (isDesktop && activeAgentId && !pathname.startsWith('/popup')) {
        items.push({
          icon: <Icon icon={ExternalLink} />,
          key: 'openInPopupWindow',
          label: t('inPopup.title', { ns: 'topic' }),
          onClick: () => {
            openTopicInNewWindow(activeAgentId, topicId);
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
    topicTitle,
    isFavorite,
    activeAgentId,
    pathname,
    workingDirectory,
    wideScreen,
    autoRenameTopicTitle,
    favoriteTopic,
    openTopicInNewWindow,
    removeTopic,
    updateTopicTitle,
    toggleWideScreen,
    t,
    modal,
    message,
  ]);

  return { menuItems };
};
