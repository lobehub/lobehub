import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import {
  ExternalLink,
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

import { isDesktop } from '@/const/version';
import { pluginRegistry } from '@/features/Electron/titlebar/RecentlyViewed/plugins';
import { openShareModal } from '@/features/ShareModal';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';

interface TopicItemDropdownMenuProps {
  fav?: boolean;
  id?: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useTopicItemDropdownMenu = ({
  fav,
  id,
  toggleEditing,
}: TopicItemDropdownMenuProps) => {
  const { t } = useTranslation(['topic', 'common']);
  const { modal } = App.useApp();
  const navigate = useNavigate();

  const openTopicInNewWindow = useGlobalStore((s) => s.openTopicInNewWindow);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const addTab = useElectronStore((s) => s.addTab);

  const [autoRenameTopicTitle, duplicateTopic, removeTopic, favoriteTopic] = useChatStore((s) => [
    s.autoRenameTopicTitle,
    s.duplicateTopic,
    s.removeTopic,
    s.favoriteTopic,
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
          toggleEditing(true);
        },
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
          ]
        : []),
      {
        icon: <Icon icon={LucideCopy} />,
        key: 'duplicate',
        label: t('actions.duplicate'),
        onClick: () => {
          duplicateTopic(id);
        },
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
    activeAgentId,
    autoRenameTopicTitle,
    duplicateTopic,
    favoriteTopic,
    removeTopic,
    openTopicInNewWindow,
    addTab,
    navigate,
    toggleEditing,
    t,
    modal,
    handleOpenShareModal,
  ]);
  return { dropdownMenu };
};
