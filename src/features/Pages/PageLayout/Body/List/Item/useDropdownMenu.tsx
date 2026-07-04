import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { CopyPlus, PanelTop, Pencil, Trash2, UsersIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useDocumentTransferMenuItem } from '@/business/client/hooks/useDocumentTransferMenuItem';
import { isDesktop } from '@/const/version';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { usePermission } from '@/hooks/usePermission';
import { useElectronStore } from '@/store/electron';
import { pageSelectors, usePageStore } from '@/store/page';

interface ActionProps {
  pageId: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useDropdownMenu = ({
  pageId,
  toggleEditing,
}: ActionProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['common', 'file']);
  const { message } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { allowed: canCreatePage } = usePermission('create_content');
  const { allowed: canEditPage } = usePermission('edit_own_content');
  const addTab = useElectronStore((s) => s.addTab);
  const removePage = usePageStore((s) => s.removePage);
  const duplicatePage = usePageStore((s) => s.duplicatePage);
  const publishPageToWorkspace = usePageStore((s) => s.publishPageToWorkspace);
  const document = usePageStore((s) => pageSelectors.getDocumentById(pageId)(s));
  const transferMenuItems = useDocumentTransferMenuItem(pageId);

  const isPrivate = document?.visibility === 'private';
  // Publish is workspace-mode + owner-only (backend also enforces via SQL
  // guard). Personal-mode has no visibility concept, so we hide the entry.
  const canPublish = Boolean(activeWorkspaceId && isPrivate && canEditPage);

  const handleDelete = () => {
    if (!canEditPage) return;

    confirmModal({
      cancelText: t('cancel'),
      content: t('pageEditor.deleteConfirm.content', { ns: 'file' }),
      okButtonProps: { danger: true },
      okText: t('delete'),
      onOk: async () => {
        try {
          await removePage(pageId);
          message.success(t('pageEditor.deleteSuccess', { ns: 'file' }));
        } catch (error) {
          console.error('Failed to delete page:', error);
          message.error(t('pageEditor.deleteError', { ns: 'file' }));
        }
      },
      title: t('pageEditor.deleteConfirm.title', { ns: 'file' }),
    });
  };

  const handleDuplicate = async () => {
    if (!canCreatePage) return;

    try {
      await duplicatePage(pageId);
    } catch (error) {
      console.error('Failed to duplicate page:', error);
    }
  };

  const handlePublish = () => {
    if (!canPublish) return;

    // Copy intentionally does not mention nested pages: Pages sidebar is a
    // flat list, so users can't see (and don't reliably know about) a
    // subtree — surfacing a "N sub-pages" count only creates confusion. The
    // server still cascades the whole subtree on the write path.
    confirmModal({
      cancelText: t('cancel'),
      content: t('pageList.publishConfirm.content', { ns: 'file' }),
      okText: t('pageList.publishConfirm.ok', { ns: 'file' }),
      onOk: async () => {
        try {
          await publishPageToWorkspace(pageId);
          message.success(t('pageList.publishSuccess', { ns: 'file' }));
        } catch (error) {
          console.error('Failed to publish page:', error);
          message.error(t('pageList.publishError', { ns: 'file' }));
        }
      },
      title: t('pageList.publishConfirm.title', { ns: 'file' }),
    });
  };

  return useCallback(
    () =>
      [
        ...(isDesktop
          ? [
              {
                icon: <Icon icon={PanelTop} />,
                key: 'openInNewTab',
                label: t('pageList.actions.openInNewTab', { ns: 'file' }),
                onClick: () => {
                  const url = buildWorkspaceAwarePath(`/page/${pageId}`, activeWorkspaceSlug);
                  addTab(url);
                  navigate(url, { escape: true });
                },
              },
              { type: 'divider' as const },
            ]
          : []),
        {
          disabled: !canEditPage,
          icon: <Icon icon={Pencil} />,
          key: 'rename',
          label: t('rename'),
          onClick: () => {
            if (!canEditPage) return;
            toggleEditing(true);
          },
        },
        {
          disabled: !canCreatePage,
          icon: <Icon icon={CopyPlus} />,
          key: 'duplicate',
          label: t('pageList.duplicate', { ns: 'file' }),
          onClick: handleDuplicate,
        },
        ...(transferMenuItems && transferMenuItems.length > 0
          ? [{ type: 'divider' as const }, ...transferMenuItems]
          : []),
        ...(canPublish
          ? [
              { type: 'divider' as const },
              {
                icon: <Icon icon={UsersIcon} />,
                key: 'publishToWorkspace',
                label: t('pageList.publishToWorkspace', { ns: 'file' }),
                onClick: handlePublish,
              },
            ]
          : []),
        { type: 'divider' },
        {
          danger: true,
          disabled: !canEditPage,
          icon: <Icon icon={Trash2} />,
          key: 'delete',
          label: t('delete'),
          onClick: handleDelete,
        },
      ].filter(Boolean) as MenuProps['items'],
    [
      t,
      toggleEditing,
      handleDuplicate,
      handleDelete,
      handlePublish,
      canCreatePage,
      canEditPage,
      canPublish,
      activeWorkspaceSlug,
      pageId,
      addTab,
      navigate,
      transferMenuItems,
    ],
  );
};
