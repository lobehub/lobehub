import { isDesktop } from '@lobechat/const';
import { type DropdownItem } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { cssVar, useResponsive } from 'antd-style';
import {
  Clock3Icon,
  CopyPlus,
  Download,
  EyeOffIcon,
  Link2,
  Maximize2,
  Trash2,
  UserRound,
  UsersIcon,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';
import { useDocumentTransferMenuItem } from '@/business/client/hooks/useDocumentTransferMenuItem';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { usePermission } from '@/hooks/usePermission';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { pageSelectors, usePageStore } from '@/store/page';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { formatPageEditorInfoTime } from '../formatPageEditorInfoTime';
import { usePageEditorStore, useStoreApi } from '../store';

/**
 * Action menu for the page editor.
 */
export const useMenu = (): { menuItems: any[] } => {
  const { i18n, t } = useTranslation(['file', 'common', 'chat']);
  const { message } = App.useApp();
  const storeApi = useStoreApi();
  const { lg = true } = useResponsive();
  const dateLocale = i18n.resolvedLanguage || i18n.language;

  const documentId = usePageEditorStore((s) => s.documentId);
  const { allowed: canCreatePage } = usePermission('create_content');
  const { allowed: canEditPage } = usePermission('edit_own_content');

  // Get lastUpdatedTime from DocumentStore (live save status within the session)
  const editorUpdatedTime = useDocumentStore((s) =>
    documentId ? editorSelectors.lastUpdatedTime(documentId)(s) : null,
  );

  const pageDocument = usePageStore(pageSelectors.getDocumentById(documentId));
  const authorName = useAuthorInfo(pageDocument?.userId)?.fullName;
  const lastUpdatedTime =
    editorUpdatedTime ??
    (pageDocument?.updatedAt ? new Date(pageDocument.updatedAt).toISOString() : null);

  const duplicateDocument = useFileStore((s) => s.duplicateDocument);
  const setRightPanelMode = usePageEditorStore((s) => s.setRightPanelMode);
  const transferMenuItems = useDocumentTransferMenuItem(documentId) as DropdownItem[] | null;

  const publishPageToWorkspace = usePageStore((s) => s.publishPageToWorkspace);
  const setPageVisibility = usePageStore((s) => s.setPageVisibility);
  const activeWorkspaceId = useActiveWorkspaceId();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  // Visibility toggles are creator-only — the backend rejects non-owner writes,
  // but the menu entry itself is the wrong affordance on someone else's page.
  const isOwnPage = Boolean(currentUserId && pageDocument?.userId === currentUserId);
  const canPublish = Boolean(
    activeWorkspaceId && isOwnPage && pageDocument?.visibility === 'private' && canEditPage,
  );
  const canMakePrivate = Boolean(
    activeWorkspaceId && isOwnPage && pageDocument?.visibility === 'public' && canEditPage,
  );

  const [togglePageAgentPanel, wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    s.togglePageAgentPanel,
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);

  // Wide screen mode only makes sense when screen is large enough
  const showViewModeSwitch = lg;

  const handleDuplicate = useCallback(async () => {
    if (!canCreatePage) return;
    if (!documentId) return;
    try {
      await duplicateDocument(documentId);
      message.success(t('pageEditor.duplicateSuccess'));
    } catch (error) {
      console.error('Failed to duplicate page:', error);
      message.error(t('pageEditor.duplicateError'));
    }
  }, [canCreatePage, documentId, duplicateDocument, message, t]);

  const handlePublish = useCallback(() => {
    if (!canPublish || !documentId) return;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: <VisibilityConfirmContent variant="publish" />,
      okText: t('continue', { ns: 'common' }),
      onOk: async () => {
        try {
          await publishPageToWorkspace(documentId);
          message.success(t('pageList.publishSuccess'));
        } catch (error) {
          console.error('Failed to publish page:', error);
          message.error(t('pageList.publishError'));
        }
      },
      title: t('pageList.publishConfirm.title'),
    });
  }, [canPublish, documentId, publishPageToWorkspace, message, t]);

  const handleMakePrivate = useCallback(() => {
    if (!canMakePrivate || !documentId) return;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: <VisibilityConfirmContent variant="makePrivate" />,
      okButtonProps: { danger: true },
      okText: t('continue', { ns: 'common' }),
      onOk: async () => {
        try {
          await setPageVisibility(documentId, 'private');
          message.success(t('makePrivate.success', { ns: 'common' }));
        } catch (error) {
          console.error('Failed to make page private:', error);
          message.error(t('makePrivate.error', { ns: 'common' }));
        }
      },
      title: t('makePrivate.confirm.title', { ns: 'common' }),
    });
  }, [canMakePrivate, documentId, setPageVisibility, message, t]);

  const handleExportMarkdown = useCallback(async () => {
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
  }, [storeApi, message, t]);

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
        disabled: !canCreatePage,
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
        icon: <Icon icon={Clock3Icon} />,
        key: 'version-history',
        label: t('pageEditor.history.title'),
        onClick: () => {
          setRightPanelMode('history');
          togglePageAgentPanel(true);
        },
      },
      {
        danger: true,
        disabled: !canEditPage,
        icon: <Icon icon={Trash2} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: async () => {
          if (!canEditPage) return;
          const state = storeApi.getState();
          await state.handleDelete(t as any, message, state.onDelete);
        },
      },
      {
        type: 'divider' as const,
      },
      ...((transferMenuItems ?? []) as DropdownItem[]),
      ...(canPublish
        ? [
            {
              icon: <Icon icon={UsersIcon} />,
              key: 'publish-to-workspace',
              label: t('pageList.publishToWorkspace'),
              onClick: handlePublish,
            } as DropdownItem,
          ]
        : []),
      ...(canMakePrivate
        ? [
            {
              icon: <Icon icon={EyeOffIcon} />,
              key: 'make-private',
              label: t('makePrivate', { ns: 'common' }),
              onClick: handleMakePrivate,
            } as DropdownItem,
          ]
        : []),
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

    if (lastUpdatedTime || authorName) {
      items.push(
        {
          type: 'divider' as const,
        },
        {
          disabled: true,
          icon: authorName ? <Icon icon={UserRound} /> : undefined,
          key: 'page-info',
          label: (
            <span style={{ color: cssVar.colorTextTertiary, fontSize: 12, lineHeight: 1.6 }}>
              {[
                authorName,
                lastUpdatedTime
                  ? t('pageEditor.editedAt', {
                      time: formatPageEditorInfoTime(lastUpdatedTime, dateLocale),
                    })
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          ),
        },
      );
    }
    return items;
  }, [
    lastUpdatedTime,
    authorName,
    canCreatePage,
    canEditPage,
    canPublish,
    canMakePrivate,
    storeApi,
    t,
    message,
    setRightPanelMode,
    wideScreen,
    dateLocale,
    toggleWideScreen,
    togglePageAgentPanel,
    showViewModeSwitch,
    handleDuplicate,
    handlePublish,
    handleMakePrivate,
    handleExportMarkdown,
    transferMenuItems,
  ]);

  return { menuItems };
};
