import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { agentDocumentService } from '@/services/agentDocument';
import { useChatStore } from '@/store/chat';

import { usePortalDocumentTitleState } from './titleContext';
import { TITLE_MAX_LENGTH, usePortalDocumentHeaderActions } from './usePortalDocumentHeader';

export const useDocumentMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { t } = useTranslation(['chat', 'common']);
  const { isLoading, metaLocked, savedTitle, saveTitle } = usePortalDocumentTitleState();
  const { agentDocumentId, agentId, documentId, refresh, url } = usePortalDocumentHeaderActions();
  const closeDocument = useChatStore((s) => s.closeDocument);

  if (!documentId || isLoading) return;

  /**
   * Removes the document this panel is showing, then pops the panel. Only a
   * document bound to the active agent has an agent-document record to remove —
   * the standalone document page hides delete on the same condition.
   */
  const deleteDocument = () => {
    if (!agentDocumentId || !agentId) return;

    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('workingPanel.resources.deleteConfirm', { ns: 'chat' }),
      okButtonProps: { danger: true },
      okText: t('delete', { ns: 'common' }),
      onOk: async () => {
        try {
          await agentDocumentService.removeDocument({ agentId, documentId, id: agentDocumentId });
          toast.success(t('workingPanel.resources.deleteSuccess', { ns: 'chat' }));
          // The panel is showing a document that no longer exists; popping it
          // returns the user to whatever the panel was opened over.
          closeDocument();
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : t('workingPanel.resources.deleteError', { ns: 'chat' }),
          );
        }
      },
      title: t('workingPanel.resources.deleteTitle', { ns: 'chat' }),
    });
  };

  return {
    copyId: documentId,
    copyLink: url,
    delete: agentDocumentId ? deleteDocument : undefined,
    refresh,
    // A dialog, like every other portal's rename — flipping the header title
    // into an input from a menu reads as a stray focused text field.
    rename: metaLocked
      ? undefined
      : () =>
          openRenameModal({
            defaultValue: savedTitle,
            maxLength: TITLE_MAX_LENGTH,
            onSave: saveTitle,
          }),
  };
};
