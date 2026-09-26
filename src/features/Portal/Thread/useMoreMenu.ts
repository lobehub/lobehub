import { confirmModal } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors } from '@/store/chat/selectors';

import { usePortalShareUrl } from '../components/PortalMoreMenu/shareUrl';
import { buildThreadSharePath } from './sharePath';

export const useThreadMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { t } = useTranslation(['thread', 'common']);
  const { allowed: canEdit } = usePermission('edit_own_content');
  const thread = useChatStore(portalThreadSelectors.portalCurrentThread, isEqual);
  const [
    activeAgentId,
    threadId,
    updateThreadTitle,
    removeThread,
    refreshThreads,
    refreshMessages,
    closeThreadPortal,
  ] = useChatStore((s) => [
    s.activeAgentId,
    s.portalThreadId,
    s.updateThreadTitle,
    s.removeThread,
    s.refreshThreads,
    s.refreshMessages,
    s.closeThreadPortal,
  ]);
  const shareUrl = usePortalShareUrl(
    buildThreadSharePath({ agentId: activeAgentId, threadId, topicId: thread?.topicId }),
  );

  // A thread being forked has no id yet — nothing to act on until it exists.
  if (!threadId || !thread) return;

  return {
    copyId: threadId,
    copyLink: shareUrl,
    delete: canEdit
      ? () =>
          confirmModal({
            cancelText: t('cancel', { ns: 'common' }),
            content: t('actions.confirmRemoveThread'),
            okButtonProps: { danger: true },
            okText: t('delete', { ns: 'common' }),
            onOk: async () => {
              await removeThread(threadId);
              closeThreadPortal();
            },
            title: t('delete', { ns: 'common' }),
          })
      : undefined,
    refresh: () =>
      Promise.all([
        refreshThreads(),
        refreshMessages({
          agentId: thread.agentId || activeAgentId,
          scope: 'thread',
          threadId,
          topicId: thread.topicId,
        }),
      ]),
    rename: canEdit
      ? () =>
          openRenameModal({
            defaultValue: thread.title,
            onSave: (next) => updateThreadTitle(threadId, next),
          })
      : undefined,
  };
};
