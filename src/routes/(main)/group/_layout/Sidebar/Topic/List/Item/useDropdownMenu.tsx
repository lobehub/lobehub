import { GROUP_CHAT_TOPIC_URL } from '@lobechat/const';
import type { ChatTopicStatus } from '@lobechat/types';
import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Hash,
  Link2,
  LucideCopy,
  PanelTop,
  PencilLine,
  Trash,
  Wand2,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { isDesktop } from '@/const/version';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
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
  const { message } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { allowed: canCreateTopic } = usePermission('create_content');
  const { allowed: canEditTopic } = usePermission('edit_own_content');

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
        disabled: !canEditTopic,
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
        disabled: !canEditTopic,
        icon: <Icon icon={Wand2} />,
        key: 'autoRename',
        label: t('actions.autoRename'),
        onClick: () => {
          autoRenameTopicTitle(id);
        },
      },
      {
        disabled: !canEditTopic,
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
                const url = buildWorkspaceAwarePath(
                  GROUP_CHAT_TOPIC_URL(activeGroupId, id),
                  activeWorkspaceSlug,
                );
                addTab(url);
                navigate(url, { escape: true });
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
        icon: <Icon icon={Hash} />,
        key: 'copySessionId',
        label: t('actions.copySessionId'),
        onClick: () => {
          navigator.clipboard.writeText(id);
          message.success(t('actions.copySessionIdSuccess'));
        },
      },
      {
        icon: <Icon icon={Link2} />,
        key: 'copyLink',
        label: t('actions.copyLink'),
        onClick: () => {
          if (!activeGroupId) return;
          const url = `${appOrigin}${GROUP_CHAT_TOPIC_URL(activeGroupId, id)}`;
          navigator.clipboard.writeText(url);
          message.success(t('actions.copyLinkSuccess'));
        },
      },
      {
        disabled: !canCreateTopic,
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
        disabled: !canEditTopic,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: () => {
          confirmModal({
            cancelText: t('cancel', { ns: 'common' }),
            content: t('actions.confirmRemoveTopic'),
            okButtonProps: { danger: true },
            okText: t('delete', { ns: 'common' }),
            onOk: async () => {
              await removeTopic(id);
            },
            title: t('delete', { ns: 'common' }),
          });
        },
      },
    ].filter(Boolean) as MenuProps['items'];
  }, [
    id,
    isCompleted,
    canCreateTopic,
    canEditTopic,
    activeGroupId,
    activeWorkspaceSlug,
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
    message,
  ]);
};
