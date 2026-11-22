import { buildAgentDocumentUrl } from '@lobechat/builtin-tool-agent-documents';
import type { DropdownItem } from '@lobehub/ui';
import { confirmModal, cssVar, Icon, toast, useResponsive } from '@lobehub/ui';
import { Download, Link2, Maximize2, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { formatPageEditorInfoTime } from '@/features/PageEditor/formatPageEditorInfoTime';
import { useIsHtmlPage } from '@/features/PageEditor/HtmlPageBody';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { agentDocumentService } from '@/services/agentDocument';
import { documentService } from '@/services/document';
import { useDocumentStore } from '@/store/document';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { exportHtmlDocument, exportMarkdownDocument } from '@/utils/exportTextFile';

interface UseMenuParams {
  agentDocumentId?: string;
  agentId: string;
  documentId: string;
  fileBacked?: boolean;
  onDeleted: () => void;
  title?: string;
  updatedAt?: Date | string | null;
}

/**
 * Action menu for the standalone agent-document page — mirrors the Pages
 * document menu (full-width toggle, copy link, export, delete, info) but acts on
 * the agent-document service.
 */
export const useMenu = ({
  agentDocumentId,
  agentId,
  documentId,
  fileBacked,
  onDeleted,
  title,
  updatedAt,
}: UseMenuParams): { menuItems: DropdownItem[] } => {
  const { i18n, t } = useTranslation(['file', 'common', 'chat']);

  const { lg = true } = useResponsive();
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const dateLocale = i18n.resolvedLanguage || i18n.language;

  // An HTML page has no Markdown to export: it downloads as the page itself.
  const isHtmlPage = useIsHtmlPage(documentId);
  const isDocumentLoaded = useDocumentStore(
    (s) =>
      s.documents[documentId] !== undefined || Boolean(s.documentDetailMap[documentId]?.document),
  );
  const htmlContent = useDocumentStore((s) =>
    isHtmlPage ? s.documentDetailMap[documentId]?.document?.content : undefined,
  );

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);

  const menuItems = useMemo<DropdownItem[]>(() => {
    const handleCopyLink = async () => {
      const url = buildAgentDocumentUrl(appOrigin, agentId, documentId, {
        workspaceSlug: activeWorkspaceSlug,
      });
      if (!url) return;
      await navigator.clipboard.writeText(url);
      toast.success(t('agentDocument.linkCopied', { ns: 'chat' }));
    };

    const handleExportMarkdown = async () => {
      try {
        // The editor canvas keeps the live buffer in `documents`; fall back to
        // the persisted detail replica, or fetch the document when neither has
        // hydrated yet so we never silently download a zero-byte file.
        const { documentDetailMap, documents } = useDocumentStore.getState();
        const liveDoc = documents[documentId];
        const persistedDoc = documentDetailMap[documentId]?.document;

        let markdown: string;
        if (liveDoc !== undefined) {
          markdown = liveDoc.content ?? persistedDoc?.content ?? '';
        } else if (persistedDoc) {
          markdown = persistedDoc.content ?? '';
        } else {
          const fetched = await documentService.getDocumentById(documentId);
          if (!fetched) {
            toast.error(t('pageEditor.exportError'));
            return;
          }
          markdown = fetched.content ?? '';
        }

        const result = await exportMarkdownDocument(markdown, title);
        if (result === 'downloaded') toast.success(t('pageEditor.exportSuccess'));
      } catch {
        toast.error(t('pageEditor.exportError'));
      }
    };

    const handleExportHtml = async () => {
      try {
        const result = await exportHtmlDocument(htmlContent ?? '', title);
        if (result === 'downloaded') toast.success(t('pageEditor.exportSuccess'));
      } catch {
        toast.error(t('pageEditor.exportError'));
      }
    };

    const handleDelete = () => {
      if (!agentDocumentId) return;
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
            onDeleted();
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

    const items: DropdownItem[] = [
      ...(lg
        ? [
            {
              checked: wideScreen,
              icon: <Icon icon={Maximize2} />,
              key: 'full-width',
              label: t('viewMode.fullWidth', { ns: 'chat' }),
              onCheckedChange: toggleWideScreen,
              type: 'switch' as const,
            },
            { type: 'divider' as const },
          ]
        : []),
      {
        icon: <Icon icon={Link2} />,
        key: 'copy-link',
        label: t('pageEditor.menu.copyLink'),
        onClick: handleCopyLink,
      },
      {
        children: isHtmlPage
          ? [
              {
                disabled: !isDocumentLoaded,
                key: 'export-html',
                label: t('pageEditor.menu.export.html'),
                onClick: handleExportHtml,
              },
            ]
          : [
              {
                disabled: !isDocumentLoaded,
                key: 'export-markdown',
                label: t('pageEditor.menu.export.markdown'),
                onClick: handleExportMarkdown,
              },
            ],
        disabled: !isDocumentLoaded,
        icon: <Icon icon={Download} />,
        key: 'export',
        label: t('pageEditor.menu.export'),
      },
      {
        danger: true,
        disabled: !agentDocumentId,
        icon: <Icon icon={Trash2} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: handleDelete,
      },
    ];

    if (updatedAt) {
      items.push(
        { type: 'divider' as const },
        {
          disabled: true,
          key: 'doc-info',
          label: (
            <span style={{ color: cssVar.colorTextTertiary, fontSize: 12, lineHeight: 1.6 }}>
              {t('pageEditor.editedAt', {
                time: formatPageEditorInfoTime(updatedAt, dateLocale),
              })}
            </span>
          ),
        },
      );
    }

    return fileBacked
      ? items.filter((item) => item?.key !== 'export' && item?.key !== 'full-width')
      : items;
  }, [
    activeWorkspaceSlug,
    agentDocumentId,
    agentId,
    appOrigin,
    documentId,
    fileBacked,
    htmlContent,
    isDocumentLoaded,
    isHtmlPage,
    lg,
    dateLocale,
    onDeleted,
    t,
    title,
    toggleWideScreen,
    updatedAt,
    wideScreen,
  ]);

  return { menuItems };
};
