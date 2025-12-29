import { Flexbox, Icon } from '@lobehub/ui';
import { App, Switch } from 'antd';
import { cssVar, useResponsive } from 'antd-style';
import dayjs from 'dayjs';
import { CopyPlus, Download, Link2, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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

  const lastUpdatedTime = usePageEditorStore((s) => s.lastUpdatedTime);
  const wordCount = usePageEditorStore((s) => s.wordCount);
  const currentDocId = usePageEditorStore((s) => s.currentDocId);

  const duplicateDocument = useFileStore((s) => s.duplicateDocument);

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);

  // Wide screen mode only makes sense when screen is large enough
  const showViewModeSwitch = lg;

  const handleDuplicate = async () => {
    if (!currentDocId) return;
    try {
      await duplicateDocument(currentDocId);
      message.success(t('pageEditor.duplicateSuccess'));
    } catch (error) {
      console.error('Failed to duplicate page:', error);
      message.error(t('pageEditor.duplicateError'));
    }
  };

  const handleExportMarkdown = () => {
    const state = storeApi.getState();
    const { editor, currentTitle } = state;

    if (!editor) return;

    try {
      const markdown = (editor.getDocument('markdown') as unknown as string) || '';
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentTitle || 'Untitled'}.md`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success(t('pageEditor.exportSuccess'));
    } catch (error) {
      console.error('Failed to export markdown:', error);
      message.error(t('pageEditor.exportError'));
    }
  };

  const menuItems = useMemo(
    () => [
      ...(showViewModeSwitch
        ? [
            {
              key: 'full-width',
              label: (
                <Flexbox align="center" horizontal justify="space-between">
                  <span>{t('viewMode.fullWidth', { ns: 'chat' })}</span>
                  <Switch
                    checked={wideScreen}
                    onChange={toggleWideScreen}
                    onClick={(checked, event) => {
                      event.stopPropagation();
                    }}
                    size="small"
                  />
                </Flexbox>
              ),
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
      {
        type: 'divider' as const,
      },
      {
        disabled: true,
        key: 'page-info',
        label: (
          <div style={{ color: cssVar.colorTextTertiary, fontSize: 12, lineHeight: 1.6 }}>
            <div>{t('pageEditor.wordCount', { wordCount })}</div>
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
    ],
    [
      wordCount,
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
    ],
  );

  return { menuItems };
};
