import { type MenuProps } from '@lobehub/ui';
import { Icon, Tooltip } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { CopyPlus, EyeOffIcon, PanelTop, Pencil, Trash2, UsersIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useDocumentTransferMenuItem } from '@/business/client/hooks/useDocumentTransferMenuItem';
import { isDesktop } from '@/const/version';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useElectronStore } from '@/store/electron';
import { pageSelectors, usePageStore } from '@/store/page';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { isForbiddenError } from '@/utils/forbiddenError';

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
  const setPageVisibility = usePageStore((s) => s.setPageVisibility);
  const document = usePageStore((s) => pageSelectors.getDocumentById(pageId)(s));
  const transferMenuItems = useDocumentTransferMenuItem(pageId, {
    transferLabel: t('pageEditor.menu.move', { ns: 'file' }),
  });
  const currentUserId = useUserStore(userProfileSelectors.userId);

  const isPrivate = document?.visibility === 'private';
  const isPublic = document?.visibility === 'public';
  // Visibility toggles are creator-only — the backend rejects non-owner writes,
  // but the menu entry itself is the wrong affordance on someone else's page.
  const isOwnPage = Boolean(currentUserId && document?.userId === currentUserId);
  const canPublish = Boolean(activeWorkspaceId && isOwnPage && isPrivate && canEditPage);
  const canMakePrivate = Boolean(activeWorkspaceId && isOwnPage && isPublic && canEditPage);

  // Row-level ownership: only the creator or a workspace owner may delete a
  // shared page — mirrors the server-side enforcement.
  const canManage = useResourceManageable(document?.userId);

  const handleDelete = useCallback(() => {
    if (!canEditPage || !canManage) return;

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
          message.error(
            isForbiddenError(error)
              ? t('manageOnlyCreator')
              : t('pageEditor.deleteError', { ns: 'file' }),
          );
        }
      },
      title: t('pageEditor.deleteConfirm.title', { ns: 'file' }),
    });
  }, [canEditPage, canManage, pageId, removePage, message, t]);

  const handleDuplicate = useCallback(async () => {
    if (!canCreatePage) return;

    try {
      await duplicatePage(pageId);
    } catch (error) {
      console.error('Failed to duplicate page:', error);
    }
  }, [canCreatePage, pageId, duplicatePage]);

  const handlePublish = useCallback(() => {
    if (!canPublish) return;

    // Copy intentionally does not mention nested pages: Pages sidebar is a
    // flat list, so users can't see (and don't reliably know about) a
    // subtree — surfacing a "N sub-pages" count only creates confusion. The
    // server still cascades the whole subtree on the write path.
    confirmModal({
      cancelText: t('cancel'),
      content: <VisibilityConfirmContent variant="publish" />,
      okText: t('continue'),
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
  }, [canPublish, pageId, publishPageToWorkspace, message, t]);

  const handleMakePrivate = useCallback(() => {
    if (!canMakePrivate) return;
    confirmModal({
      cancelText: t('cancel'),
      content: <VisibilityConfirmContent variant="makePrivate" />,
      okButtonProps: { danger: true },
      okText: t('continue'),
      onOk: async () => {
        try {
          await setPageVisibility(pageId, 'private');
          message.success(t('makePrivate.success'));
        } catch (error) {
          console.error('Failed to make page private:', error);
          message.error(t('makePrivate.error'));
        }
      },
      title: t('makePrivate.confirm.title'),
    });
  }, [canMakePrivate, pageId, setPageVisibility, message, t]);

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
        ...(canMakePrivate
          ? [
              { type: 'divider' as const },
              {
                icon: <Icon icon={EyeOffIcon} />,
                key: 'makePrivate',
                label: t('makePrivate'),
                onClick: handleMakePrivate,
              },
            ]
          : []),
        { type: 'divider' },
        {
          danger: true,
          disabled: !canEditPage || !canManage,
          icon: <Icon icon={Trash2} />,
          key: 'delete',
          label: canManage ? (
            t('delete')
          ) : (
            <Tooltip title={t('manageOnlyCreator')}>
              <span>{t('delete')}</span>
            </Tooltip>
          ),
          onClick: handleDelete,
        },
      ].filter(Boolean) as MenuProps['items'],
    [
      t,
      toggleEditing,
      handleDuplicate,
      handleDelete,
      handlePublish,
      handleMakePrivate,
      canCreatePage,
      canEditPage,
      canManage,
      canPublish,
      canMakePrivate,
      activeWorkspaceSlug,
      pageId,
      addTab,
      navigate,
      transferMenuItems,
    ],
  );
};
