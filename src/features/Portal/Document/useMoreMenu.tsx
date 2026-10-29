import { confirmModal, Icon, toast } from '@lobehub/ui';
import { DownloadIcon, Maximize2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { agentDocumentService } from '@/services/agentDocument';
import { useChatStore } from '@/store/chat';

import { usePortalDocumentTitleState } from './titleContext';
import { useHtmlExport } from './useHtmlExport';
import { useMarkdownExport } from './useMarkdownExport';
import { TITLE_MAX_LENGTH, usePortalDocumentHeaderActions } from './usePortalDocumentHeader';

export const useDocumentMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { t } = useTranslation(['chat', 'common']);
  const { isLoading, metaLocked, savedTitle, saveTitle } = usePortalDocumentTitleState();
  const { agentDocumentId, agentId, documentId, path, refresh, url } =
    usePortalDocumentHeaderActions();
  const closeDocument = useChatStore((s) => s.closeDocument);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  const navigate = useWorkspaceAwareNavigate();
  const exportMarkdown = useMarkdownExport(documentId);
  // An HTML page downloads as the page itself; it has no Markdown to export.
  const exportHtml = useHtmlExport(documentId);
  const exportDocument = exportHtml ?? exportMarkdown;

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
          await agentDocumentService.removeDocument({
            agentId,
            documentId,
            id: agentDocumentId,
            // Documents nested under it go with it, as a folder's contents do.
            withChildren: true,
          });
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
    extraItems: [
      // The header's expand icon in words: open the document as a full page.
      ...(path
        ? [
            {
              icon: <Icon icon={Maximize2Icon} />,
              key: 'open-as-page',
              label: t('agentDocument.openAsPage', { ns: 'chat' }),
              onClick: () => {
                navigate(path);
                clearPortalStack();
              },
            },
          ]
        : []),
      ...(exportDocument
        ? [
            {
              icon: <Icon icon={DownloadIcon} />,
              key: 'export',
              label: t('agentDocument.portal.export', { ns: 'chat' }),
              onClick: () => void exportDocument(),
            },
          ]
        : []),
    ],
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
