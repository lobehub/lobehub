import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { toast } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { confirmRemoveTopic } from '@/features/DeleteTopicConfirm';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, topicSelectors } from '@/store/chat/selectors';
import { isForbiddenError } from '@/utils/forbiddenError';

import { usePortalShareUrl } from '../components/PortalMoreMenu/shareUrl';

export const useTopicMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { t } = useTranslation(['topic', 'common']);
  const { allowed: canEdit } = usePermission('edit_own_content');
  // The side-by-side topic always belongs to the agent of the main column.
  const [
    agentId,
    topicId,
    title,
    updateTopicTitle,
    removeTopic,
    refreshMessages,
    closeTopicPortal,
  ] = useChatStore((s) => {
    const id = chatPortalSelectors.portalTopicId(s);
    return [
      s.activeAgentId,
      id,
      id ? topicSelectors.getTopicById(id)(s)?.title : undefined,
      s.updateTopicTitle,
      s.removeTopic,
      s.refreshMessages,
      s.closeTopicPortal,
    ] as const;
  });
  const shareUrl = usePortalShareUrl(
    agentId && topicId ? AGENT_CHAT_TOPIC_URL(agentId, topicId) : undefined,
  );

  if (!topicId) return;

  const toastWriteError = (error: unknown) =>
    toast.error(
      isForbiddenError(error)
        ? t('manageOnlyCreator', { ns: 'common' })
        : t('operationFailed', { ns: 'common' }),
    );

  return {
    copyId: topicId,
    copyLink: shareUrl,
    delete: canEdit
      ? () =>
          void confirmRemoveTopic({
            onConfirm: async (removeFiles) => {
              try {
                await removeTopic(topicId, removeFiles);
                // The store never closes the pane showing the removed topic.
                closeTopicPortal();
              } catch (error) {
                toastWriteError(error);
              }
            },
            topicIds: [topicId],
          })
      : undefined,
    refresh: () => refreshMessages({ agentId, topicId }),
    rename: canEdit
      ? () =>
          openRenameModal({
            defaultValue: title ?? '',
            description: t('renameModal.description'),
            onSave: async (next) => {
              try {
                await updateTopicTitle(topicId, next);
              } catch (error) {
                toastWriteError(error);
              }
            },
            title: t('renameModal.title'),
          })
      : undefined,
  };
};
