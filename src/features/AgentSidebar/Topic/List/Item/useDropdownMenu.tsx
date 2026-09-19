import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { ChatTopicStatus } from '@lobechat/types';
import { type MenuProps } from '@lobehub/ui';
import { copyToClipboard, Icon } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import {
  Archive,
  ArchiveRestore,
  Download,
  ExternalLink,
  FolderInput,
  Forward,
  Hash,
  Link2,
  LucideCopy,
  PanelRight,
  PanelTop,
  PencilLine,
  Star,
  Stethoscope,
  Trash,
  Wand2,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { openRenameModal } from '@/components/RenameModal';
import { isDesktop } from '@/const/version';
import { createMoveTopicsModal } from '@/features/AgentTopicManager/MoveTopicsModal';
import { createTopicForwardModal } from '@/features/Conversation/MessageForward/TopicForwardModal';
import { confirmRemoveTopic } from '@/features/DeleteTopicConfirm';
import { getProjectConversationPath } from '@/features/Projects/Layout/navigation';
import { openShareModal } from '@/features/ShareModal';
import { openTopicDoctorModal } from '@/features/TopicDoctorModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
import { topicService } from '@/services/topic';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';
import { isForbiddenError } from '@/utils/forbiddenError';

import { useScopedTopic, useScopedTopics } from '../../useScopedTopics';

export interface TopicItemDropdownMenuProps {
  completionLabel?: string;
  fav?: boolean;
  id?: string;
  status?: ChatTopicStatus | null;
  title: string;
}

export const useTopicItemDropdownMenu = ({
  completionLabel,
  fav,
  id,
  status,
  title,
}: TopicItemDropdownMenuProps) => {
  const { t } = useTranslation(['topic', 'common', 'chat']);

  const navigate = useWorkspaceAwareNavigate();
  const { pathname } = useActiveLocation();
  const routeTopicId = pathname.match(/\/project\/[^/]+\/conversation\/([^/]+)\/?$/)?.[1];
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { allowed: canCreateTopic } = usePermission('create_content');
  const { allowed: canEditTopic } = usePermission('edit_own_content');

  const openTopicInNewWindow = useGlobalStore((s) => s.openTopicInNewWindow);
  const openTopicInPortal = useChatStore((s) => s.openTopicInPortal);
  const scopedTopic = useScopedTopic(id);
  const { scope, refresh } = useScopedTopics();
  const fallbackAgentId = useAgentStore((s) => s.activeAgentId);
  const activeAgentId = scopedTopic?.agentId ?? fallbackAgentId;
  const addTab = useElectronStore((s) => s.addTab);
  const appOrigin = useAppOrigin();

  const [
    autoRenameTopicTitle,
    duplicateTopic,
    removeTopic,
    favoriteTopic,
    markTopicCompleted,
    unmarkTopicCompleted,
    updateTopicTitle,
  ] = useChatStore((s) => [
    s.autoRenameTopicTitle,
    s.duplicateTopic,
    s.removeTopic,
    s.favoriteTopic,
    s.markTopicCompleted,
    s.unmarkTopicCompleted,
    s.updateTopicTitle,
  ]);

  const isCompleted = status === 'completed';
  const handleOpenShareModal = useCallback(() => {
    if (!id) return;

    void openShareModal({ context: { threadId: null, topicId: id } });
  }, [id]);

  const dropdownMenu = useCallback(() => {
    if (!id) return [];

    return [
      {
        disabled: !canEditTopic,
        icon: <Icon icon={isCompleted ? ArchiveRestore : Archive} />,
        key: 'markCompleted',
        label:
          completionLabel ??
          (isCompleted ? t('actions.unmarkCompleted') : t('actions.markCompleted')),
        onClick: async () => {
          if (isCompleted) await unmarkTopicCompleted(id);
          else await markTopicCompleted(id);
          if (scope) await refresh();
        },
        sfSymbol: isCompleted ? 'tray.and.arrow.up' : 'archivebox',
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={Star} />,
        key: 'favorite',
        label: fav ? t('actions.unfavorite') : t('actions.favorite'),
        onClick: async () => {
          await favoriteTopic(id, !fav);
          if (scope) await refresh();
        },
        sfSymbol: fav ? 'star.slash' : 'star',
      },
      {
        type: 'divider' as const,
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={Wand2} />,
        key: 'autoRename',
        label: t('actions.autoRename'),
        onClick: async () => {
          await autoRenameTopicTitle(id, scopedTopic?.agentId ?? undefined);
          if (scope) await refresh();
        },
        sfSymbol: 'wand.and.stars',
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={PencilLine} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: () => {
          openRenameModal({
            defaultValue: title,
            description: t('renameModal.description', { ns: 'topic' }),
            onSave: async (newTitle) => {
              try {
                await updateTopicTitle(id, newTitle);
                if (scope) await refresh();
              } catch (error) {
                toast.error(
                  isForbiddenError(error)
                    ? t('manageOnlyCreator', { ns: 'common' })
                    : t('operationFailed', { ns: 'common' }),
                );
              }
            },
            title: t('renameModal.title', { ns: 'topic' }),
          });
        },
        sfSymbol: 'pencil',
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={Stethoscope} />,
        key: 'diagnose',
        label: t('actions.diagnose'),
        onClick: () => {
          openTopicDoctorModal({ agentId: activeAgentId, topicId: id });
        },
        sfSymbol: 'stethoscope',
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
                const url = buildWorkspaceAwarePath(
                  AGENT_CHAT_TOPIC_URL(activeAgentId, id),
                  activeWorkspaceSlug,
                );
                addTab(url);
                navigate(url, { escape: true });
              },
            },
          ]
        : []),
      {
        icon: <Icon icon={PanelRight} />,
        key: 'openOnRight',
        label: t('openOnRight', { ns: 'common' }),
        onClick: () => {
          openTopicInPortal(id);
        },
      },
      ...(isDesktop
        ? [
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
        : [{ type: 'divider' as const }]),
      {
        icon: <Icon icon={Hash} />,
        key: 'copySessionId',
        label: t('actions.copySessionId'),
        onClick: async () => {
          await copyToClipboard(id);
          toast.success(t('actions.copySessionIdSuccess'));
        },
      },
      {
        icon: <Icon icon={Link2} />,
        key: 'copyLink',
        label: t('actions.copyLink'),
        onClick: async () => {
          if (!activeAgentId) return;
          const url = `${appOrigin}${AGENT_CHAT_TOPIC_URL(activeAgentId, id)}`;
          await copyToClipboard(url);
          toast.success(t('actions.copyLinkSuccess'));
        },
      },
      {
        type: 'divider' as const,
      },
      {
        disabled: !canCreateTopic,
        icon: <Icon icon={LucideCopy} />,
        key: 'duplicate',
        label: t('actions.duplicate'),
        onClick: async () => {
          if (!scope) return duplicateTopic(id);
          const loadingToast = toast.loading(t('duplicateLoading', { ns: 'topic' }));
          try {
            const newId = await topicService.cloneTopic(
              id,
              t('duplicateTitle', { ns: 'chat', title }),
            );
            await refresh();
            navigate(getProjectConversationPath(scope.projectId, newId));
            toast.success(t('duplicateSuccess', { ns: 'topic' }));
          } finally {
            loadingToast.close();
          }
        },
      },
      {
        disabled: !canCreateTopic || !activeAgentId,
        icon: <Icon icon={Forward} />,
        key: 'forwardToAgent',
        label: t('actions.forwardToAgent'),
        onClick: () => {
          if (!activeAgentId) return;
          createTopicForwardModal({ sourceAgentId: activeAgentId, topicId: id, topicTitle: title });
        },
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={FolderInput} />,
        key: 'moveToAgent',
        label: t('actions.moveToAgent'),
        onClick: () => {
          createMoveTopicsModal({ sourceAgentId: activeAgentId, topicIds: [id] });
        },
      },
      {
        type: 'divider' as const,
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={Download} />,
        key: 'share',
        label: t('shareModal.title', { ns: 'chat' }),
        onClick: handleOpenShareModal,
        sfSymbol: 'square.and.arrow.up',
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
          void confirmRemoveTopic({
            onConfirm: async (removeFiles) => {
              try {
                await removeTopic(id, removeFiles);
                if (scope) {
                  if (routeTopicId === id) navigate(`/project/${scope.projectId}`);
                  await refresh();
                }
              } catch (error) {
                toast.error(
                  isForbiddenError(error)
                    ? t('manageOnlyCreator', { ns: 'common' })
                    : t('operationFailed', { ns: 'common' }),
                );
              }
            },
            topicIds: [id],
          });
        },
        sfSymbol: 'trash',
      },
    ].filter(Boolean) as MenuProps['items'];
  }, [
    routeTopicId,
    scope,
    scopedTopic,
    refresh,
    id,
    fav,
    isCompleted,
    completionLabel,
    title,
    canCreateTopic,
    canEditTopic,
    activeAgentId,
    activeWorkspaceSlug,
    appOrigin,
    autoRenameTopicTitle,
    duplicateTopic,
    favoriteTopic,
    markTopicCompleted,
    unmarkTopicCompleted,
    removeTopic,
    updateTopicTitle,
    openTopicInNewWindow,
    openTopicInPortal,
    addTab,
    navigate,
    t,
    handleOpenShareModal,
  ]);
  return { dropdownMenu };
};
