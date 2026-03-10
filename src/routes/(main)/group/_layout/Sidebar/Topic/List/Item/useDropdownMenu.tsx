import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { ExternalLink, LucideCopy, PanelTop, PencilLine, Trash, Wand2 } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { isDesktop } from '@/const/version';
import { pluginRegistry } from '@/features/Electron/titlebar/RecentlyViewed/plugins';
import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';

interface TopicItemDropdownMenuProps {
  id?: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useTopicItemDropdownMenu = ({
  id,
  toggleEditing,
}: TopicItemDropdownMenuProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['topic', 'common']);
  const { modal } = App.useApp();
  const navigate = useNavigate();

  const openTopicInNewWindow = useGlobalStore((s) => s.openTopicInNewWindow);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const activeGroupId = useAgentGroupStore((s) => s.activeGroupId);
  const addTab = useElectronStore((s) => s.addTab);

  const [autoRenameTopicTitle, duplicateTopic, removeTopic] = useChatStore((s) => [
    s.autoRenameTopicTitle,
    s.duplicateTopic,
    s.removeTopic,
  ]);

  return useCallback(() => {
    if (!id) return [];

    return [
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
                if (!activeGroupId) return;
                const url = `/group/${activeGroupId}?topic=${id}`;
                const reference = pluginRegistry.parseUrl(`/group/${activeGroupId}`, `topic=${id}`);
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
        type: 'divider' as const,
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
    activeAgentId,
    activeGroupId,
    autoRenameTopicTitle,
    duplicateTopic,
    removeTopic,
    openTopicInNewWindow,
    addTab,
    navigate,
    toggleEditing,
    t,
    modal,
  ]);
};
