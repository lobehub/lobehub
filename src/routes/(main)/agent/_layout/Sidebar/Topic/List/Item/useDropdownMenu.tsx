import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import {
  ExternalLink,
  Link2,
  LucideCopy,
  PanelTop,
  PencilLine,
  Share2,
  Star,
  Trash,
  Wand2,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { openRenameModal } from '@/components/RenameModal';
import { isDesktop } from '@/const/version';
import { pluginRegistry } from '@/features/Electron/titlebar/RecentlyViewed/plugins';
import { openShareModal } from '@/features/ShareModal';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';

interface TopicItemDropdownMenuProps {
  fav?: boolean;
  id?: string;
  title: string;
}

export const useTopicItemDropdownMenu = ({ fav, id, title }: TopicItemDropdownMenuProps) => {
  const { t } = useTranslation(['topic', 'common']);
  const { modal, message } = App.useApp();
  const navigate = useNavigate();

  const openTopicInNewWindow = useGlobalStore((s) => s.openTopicInNewWindow);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const addTab = useElectronStore((s) => s.addTab);
  const appOrigin = useAppOrigin();

  const [autoRenameTopicTitle, duplicateTopic, removeTopic, favoriteTopic, updateTopicTitle] =
    useChatStore((s) => [
      s.autoRenameTopicTitle,
      s.duplicateTopic,
      s.removeTopic,
      s.favoriteTopic,
      s.updateTopicTitle,
    ]);
  const handleOpenShareModal = useCallback(() => {
    if (!id) return;

    openShareModal({ context: { threadId: null, topicId: id } });
  }, [id]);

  const dropdownMenu = useCallback(() => {
    if (!id) return [];

    return [
      {
        icon: <Icon icon={Star} />,
        key: 'favorite',
        label: fav ? t('actions.unfavorite') : t('actions.favorite'),
        onClick: () => {
          favoriteTopic(id, !fav);
        },
      },
      {
        type: 'divider' as const,
      },
      {
        icon: <Icon icon={Wand2} />,
        key: 'autoRename',
        label: t('actions.autoRename'),
        onClick: () => {
          autoRenameTopicTitle(id);
        },
      },
      {
        icon: <Icon icon={PencilLine} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: () => {
          openRenameModal({
            defaultValue: title,
            description: t('renameModal.description', { ns: 'topic' }),
            onSave: async (newTitle) => {
              await updateTopicTitle(id, newTitle);
            },
            title: t('renameModal.title', { ns: 'topic' }),
          });
        },
      },
      {
        type: 'divider' as const,
      },
      ...(isDesktop
        ? [
            {
              icon: <Icon icon={PanelTop} />,
              key: 'openInNewTab',
              label: t('actions.openInNewTab'),
              onClick: () => {
                if (!activeAgentId) return;
                const url = `/agent/${activeAgentId}?topic=${id}`;
                const reference = pluginRegistry.parseUrl(`/agent/${activeAgentId}`, `topic=${id}`);
                if (reference) {
                  addTab(reference);
                  navigate(url);
                }
              },
            },
            {
              icon: <Icon icon={ExternalLink} />,
              key: 'openInNewWindow',
              label: t('actions.openInNewWindow'),
              onClick: () => {
                if (activeAgentId) openTopicInNewWindow(activeAgentId, id);
              },
            },
            {
              type: 'divider' as const,
            },
          ]
        : []),
      {
        icon: <Icon icon={Link2} />,
        key: 'copyLink',
        label: t('actions.copyLink'),
        onClick: () => {
          if (!activeAgentId) return;
          const url = `${appOrigin}/agent/${activeAgentId}?topic=${id}`;
          navigator.clipboard.writeText(url);
          message.success(t('actions.copyLinkSuccess'));
        },
      },
      {
        icon: <Icon icon={LucideCopy} />,
        key: 'duplicate',
        label: t('actions.duplicate'),
        onClick: () => {
          duplicateTopic(id);
        },
      },
      {
        type: 'divider' as const,
      },
      {
        icon: <Icon icon={Share2} />,
        key: 'share',
        label: t('share', { ns: 'common' }),
        onClick: handleOpenShareModal,
      },
      {
        type: 'divider' as const,
      },
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
              await removeTopic(id);
            },
            title: t('actions.confirmRemoveTopic'),
          });
        },
      },
    ].filter(Boolean) as MenuProps['items'];
  }, [
    id,
    fav,
    title,
    activeAgentId,
    appOrigin,
    autoRenameTopicTitle,
    duplicateTopic,
    favoriteTopic,
    removeTopic,
    updateTopicTitle,
    openTopicInNewWindow,
    addTab,
    navigate,
    t,
    modal,
    message,
    handleOpenShareModal,
  ]);
  return { dropdownMenu };
};
