import { isDesktop } from '@lobechat/const';
import { type DropdownItem } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar, useResponsive } from 'antd-style';
import dayjs from 'dayjs';
import { CopyPlus, Download, Link2, Maximize2, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { usePageEditorStore, useStoreApi } from '../store';

/**
 * Action menu for the page editor.
 */
export const useMenu = (): { menuItems: any[] } => {
  const { t } = useTranslation(['file', 'common', 'chat']);
  const { message, modal } = App.useApp();
  const storeApi = useStoreApi();
  const { lg = true } = useResponsive();

  const documentId = usePageEditorStore((s) => s.documentId);

  // Get lastUpdatedTime from DocumentStore
  const lastUpdatedTime = useDocumentStore((s) =>
    documentId ? editorSelectors.lastUpdatedTime(documentId)(s) : null,
  );

  const duplicateDocument = useFileStore((s) => s.duplicateDocument);

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);

  // Wide screen mode only makes sense when screen is large enough
  const showViewModeSwitch = lg;

  const handleDuplicate = async () => {
    if (!documentId) return;
    try {
      await duplicateDocument(documentId);
      message.success(t('pageEditor.duplicateSuccess'));
    } catch (error) {
      console.error('Failed to duplicate page:', error);
      message.error(t('pageEditor.duplicateError'));
    }
  };

  const handleExportMarkdown = async () => {
    const state = storeApi.getState();
    const { editor, title } = state;

    if (!editor) return;

    try {
      const markdown = (editor.getDocument('markdown') as unknown as string) || '';
      const fileName = `${title || 'Untitled'}.md`;

      if (isDesktop) {
        const { desktopExportService } = await import('@/services/electron/desktopExportService');
        await desktopExportService.exportMarkdown({
          content: markdown,
          fileName,
        });
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
    } catch (error) {
      console.error('Failed to export markdown:', error);
      message.error(t('pageEditor.exportError'));
    }
  };

  const menuItems = useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [
      ...(showViewModeSwitch
        ? [
            {
              checked: wideScreen,
              icon: <Icon icon={Maximize2} />,
              key: 'full-width',
              label: t('viewMode.fullWidth', { ns: 'chat' }),
              onCheckedChange: toggleWideScreen,
              type: 'switch' as const,
            },
            {
              type: 'divider' as const,
            },
          ]
        : []),
      {
        icon: <Icon icon={CopyPlus} />,
        key: 'duplicate',
        label: t('pageList.duplicate'),
        onClick: handleDuplicate,
      },
      {
        icon: <Icon icon={Link2} />,
        key: 'copy-link',
        label: t('pageEditor.menu.copyLink'),
        onClick: () => {
          const state = storeApi.getState();
          state.handleCopyLink(t as any, message);
        },
      },
      {
        danger: true,
        icon: <Icon icon={Trash2} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: async () => {
          const state = storeApi.getState();
          await state.handleDelete(t as any, message, modal, state.onDelete);
        },
      },
      {
        type: 'divider' as const,
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
    ];

    if (lastUpdatedTime) {
      items.push(
        {
          type: 'divider' as const,
        },
        {
          disabled: true,
          key: 'page-info',
          label: (
            <div style={{ color: cssVar.colorTextTertiary, fontSize: 12, lineHeight: 1.6 }}>
              <div>
                {lastUpdatedTime
                  ? t('pageEditor.editedAt', {
                      time: dayjs(lastUpdatedTime).format('MMMM D, YYYY [at] h:mm A'),
                    })
                  : ''}
              </div>
            </div>
          ),
        },
      );
    }
    return items;
  }, [
    lastUpdatedTime,
    storeApi,
    t,
    message,
    modal,
    wideScreen,
    toggleWideScreen,
    showViewModeSwitch,
    handleDuplicate,
    handleExportMarkdown,
  ]);

  return { menuItems };
};
