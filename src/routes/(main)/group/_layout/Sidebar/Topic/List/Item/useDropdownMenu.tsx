import type { ChatTopicStatus } from '@lobechat/types';
import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Link2,
  LucideCopy,
  PanelTop,
  PencilLine,
  Trash,
  Wand2,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { isDesktop } from '@/const/version';
import { pluginRegistry } from '@/features/Electron/titlebar/RecentlyViewed/plugins';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';

interface TopicItemDropdownMenuProps {
  id?: string;
  status?: ChatTopicStatus | null;
  toggleEditing: (visible?: boolean) => void;
}

export const useTopicItemDropdownMenu = ({
  id,
  status,
  toggleEditing,
}: TopicItemDropdownMenuProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['topic', 'common']);
  const { modal, message } = App.useApp();
  const navigate = useNavigate();

  const openGroupTopicInNewWindow = useGlobalStore((s) => s.openGroupTopicInNewWindow);
  const activeGroupId = useAgentGroupStore((s) => s.activeGroupId);
  const addTab = useElectronStore((s) => s.addTab);
  const appOrigin = useAppOrigin();

  const [
    autoRenameTopicTitle,
    duplicateTopic,
    removeTopic,
    markTopicCompleted,
    unmarkTopicCompleted,
  ] = useChatStore((s) => [
    s.autoRenameTopicTitle,
    s.duplicateTopic,
    s.removeTopic,
    s.markTopicCompleted,
    s.unmarkTopicCompleted,
  ]);

  const isCompleted = status === 'completed';

  return useCallback(() => {
    if (!id) return [];

    return [
      {
        icon: <Icon icon={isCompleted ? Circle : CheckCircle2} />,
        key: 'markCompleted',
        label: isCompleted ? t('actions.unmarkCompleted') : t('actions.markCompleted'),
        onClick: () => {
          if (isCompleted) {
            unmarkTopicCompleted(id);
          } else {
            markTopicCompleted(id);
          }
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
                if (activeGroupId) openGroupTopicInNewWindow(activeGroupId, id);
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
          if (!activeGroupId) return;
          const url = `${appOrigin}/group/${activeGroupId}?topic=${id}`;
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
    isCompleted,
    activeGroupId,
    appOrigin,
    autoRenameTopicTitle,
    duplicateTopic,
    markTopicCompleted,
    unmarkTopicCompleted,
    removeTopic,
    openGroupTopicInNewWindow,
    addTab,
    navigate,
    toggleEditing,
    t,
    modal,
    message,
  ]);
};
