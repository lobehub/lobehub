import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { ChatTopicStatus } from '@lobechat/types';
import type { MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  Hash,
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

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { openRenameModal } from '@/components/RenameModal';
import { isDesktop } from '@/const/version';
import { confirmRemoveTopic } from '@/features/DeleteTopicConfirm';
import { openShareModal } from '@/features/ShareModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';

interface UseDropdownMenuProps {
  agentId?: string;
  fav?: boolean;
  onClose: () => void;
  onDelete?: (topicId: string) => void;
  status?: ChatTopicStatus | null;
  topicId: string;
  topicTitle: string;
}

export const useDropdownMenu = ({
  agentId,
  fav,
  onClose,
  onDelete,
  status,
  topicId,
  topicTitle,
}: UseDropdownMenuProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['common', 'topic']);
  const { message } = App.useApp();
  const appOrigin = useAppOrigin();
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { allowed: canCreateTopic } = usePermission('create_content');
  const { allowed: canEditTopic } = usePermission('edit_own_content');

  const addTab = useElectronStore((s) => s.addTab);
  const openTopicInNewWindow = useGlobalStore((s) => s.openTopicInNewWindow);

  const [
    autoRenameTopicTitle,
    duplicateTopic,
    favoriteTopic,
    markTopicCompleted,
    removeTopic,
    unmarkTopicCompleted,
    updateTopicTitle,
  ] = useChatStore((s) => [
    s.autoRenameTopicTitle,
    s.duplicateTopic,
    s.favoriteTopic,
    s.markTopicCompleted,
    s.removeTopic,
    s.unmarkTopicCompleted,
    s.updateTopicTitle,
  ]);

  const isCompleted = status === 'completed';
  const handleOpenShareModal = useCallback(() => {
    openShareModal({ context: { threadId: null, topicId } });
  }, [topicId]);

  return useCallback(
    () =>
      [
        {
          disabled: !canEditTopic,
          icon: <Icon icon={isCompleted ? ArchiveRestore : Archive} />,
          key: 'markCompleted',
          label: isCompleted
            ? t('actions.unmarkCompleted', { ns: 'topic' })
            : t('actions.markCompleted', { ns: 'topic' }),
          onClick: () => {
            if (isCompleted) {
              unmarkTopicCompleted(topicId);
            } else {
              markTopicCompleted(topicId);
            }
          },
        },
        {
          type: 'divider' as const,
        },
        {
          disabled: !canEditTopic,
          icon: <Icon icon={Star} />,
          key: 'favorite',
          label: fav
            ? t('actions.unfavorite', { ns: 'topic' })
            : t('actions.favorite', { ns: 'topic' }),
          onClick: () => {
            favoriteTopic(topicId, !fav);
          },
        },
        {
          type: 'divider' as const,
        },
        {
          disabled: !canEditTopic,
          icon: <Icon icon={Wand2} />,
          key: 'autoRename',
          label: t('actions.autoRename', { ns: 'topic' }),
          onClick: () => {
            autoRenameTopicTitle(topicId);
          },
        },
        {
          disabled: !canEditTopic,
          icon: <Icon icon={PencilLine} />,
          key: 'rename',
          label: t('rename'),
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
        {
          type: 'divider' as const,
        },
        ...(isDesktop
          ? [
              {
                disabled: !agentId,
                icon: <Icon icon={PanelTop} />,
                key: 'openInNewTab',
                label: t('actions.openInNewTab', { ns: 'topic' }),
                onClick: () => {
                  if (!agentId) return;
                  const url = buildWorkspaceAwarePath(
                    AGENT_CHAT_TOPIC_URL(agentId, topicId),
                    activeWorkspaceSlug,
                  );
                  addTab(url);
                  navigate(url, { escape: true });
                  onClose();
                },
              },
              {
                disabled: !agentId,
                icon: <Icon icon={ExternalLink} />,
                key: 'openInNewWindow',
                label: t('actions.openInNewWindow', { ns: 'topic' }),
                onClick: () => {
                  if (!agentId) return;
                  openTopicInNewWindow(agentId, topicId);
                  onClose();
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
          label: t('actions.copySessionId', { ns: 'topic' }),
          onClick: () => {
            void navigator.clipboard.writeText(topicId);
            message.success(t('actions.copySessionIdSuccess', { ns: 'topic' }));
          },
        },
        {
          disabled: !agentId,
          icon: <Icon icon={Link2} />,
          key: 'copyLink',
          label: t('actions.copyLink', { ns: 'topic' }),
          onClick: () => {
            if (!agentId) return;
            const url = `${appOrigin}${AGENT_CHAT_TOPIC_URL(agentId, topicId)}`;
            void navigator.clipboard.writeText(url);
            message.success(t('actions.copyLinkSuccess', { ns: 'topic' }));
          },
        },
        {
          disabled: !canCreateTopic,
          icon: <Icon icon={LucideCopy} />,
          key: 'duplicate',
          label: t('actions.duplicate', { ns: 'topic' }),
          onClick: () => {
            duplicateTopic(topicId);
          },
        },
        {
          type: 'divider' as const,
        },
        {
          disabled: !canEditTopic,
          icon: <Icon icon={Share2} />,
          key: 'share',
          label: t('share'),
          onClick: handleOpenShareModal,
        },
        {
          type: 'divider' as const,
        },
        {
          danger: true,
          disabled: !canEditTopic,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete'),
          onClick: () => {
            void confirmRemoveTopic({
              onConfirm: async (removeFiles) => {
                await removeTopic(topicId, removeFiles);
                onDelete?.(topicId);
                onClose();
              },
              topicIds: [topicId],
            });
          },
        },
      ].filter(Boolean) as MenuProps['items'],
    [
      addTab,
      activeWorkspaceSlug,
      agentId,
      appOrigin,
      autoRenameTopicTitle,
      canCreateTopic,
      canEditTopic,
      duplicateTopic,
      favoriteTopic,
      fav,
      handleOpenShareModal,
      isCompleted,
      markTopicCompleted,
      message,
      navigate,
      onClose,
      onDelete,
      openTopicInNewWindow,
      removeTopic,
      t,
      topicId,
      topicTitle,
      unmarkTopicCompleted,
      updateTopicTitle,
    ],
  );
};
