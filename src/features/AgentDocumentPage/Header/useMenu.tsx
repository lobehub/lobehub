import { buildAgentDocumentUrl } from '@lobechat/builtin-tool-agent-documents';
import { isDesktop } from '@lobechat/const';
import { useEditor } from '@lobehub/editor/react';
import { Icon } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { cssVar, useResponsive } from 'antd-style';
import { Download, Link2, Maximize2, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { formatPageEditorInfoTime } from '@/features/PageEditor/formatPageEditorInfoTime';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { agentDocumentService } from '@/services/agentDocument';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

interface UseMenuParams {
  agentDocumentId?: string;
  agentId: string;
  documentId: string;
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
  onDeleted,
  title,
  updatedAt,
}: UseMenuParams): { menuItems: DropdownItem[] } => {
  const { i18n, t } = useTranslation(['file', 'common', 'chat']);
  const { message } = App.useApp();
  const { lg = true } = useResponsive();
  const editor = useEditor();
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const dateLocale = i18n.resolvedLanguage || i18n.language;

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
      message.success(t('agentDocument.linkCopied', { ns: 'chat' }));
    };

    const handleExportMarkdown = async () => {
      if (!editor) return;
      const markdown = (editor.getDocument('markdown') as unknown as string) || '';
      const fileName = `${title || 'Untitled'}.md`;
      try {
        if (isDesktop) {
          const { desktopExportService } = await import('@/services/electron/desktopExportService');
          await desktopExportService.exportMarkdown({ content: markdown, fileName });
        } else {
          const blob = new Blob([markdown], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.append(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          message.success(t('pageEditor.exportSuccess'));
        }
      } catch {
        message.error(t('pageEditor.exportError'));
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
            await agentDocumentService.removeDocument({ agentId, documentId, id: agentDocumentId });
            message.success(t('workingPanel.resources.deleteSuccess', { ns: 'chat' }));
            onDeleted();
          } catch (error) {
            message.error(
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
        children: [
          {
            key: 'export-markdown',
            label: t('pageEditor.menu.export.markdown'),
            onClick: handleExportMarkdown,
          },
        ],
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

    return items;
  }, [
    activeWorkspaceSlug,
    agentDocumentId,
    agentId,
    appOrigin,
    documentId,
    editor,
    lg,
    dateLocale,
    message,
    onDeleted,
    t,
    title,
    toggleWideScreen,
    updatedAt,
    wideScreen,
  ]);

  return { menuItems };
};
