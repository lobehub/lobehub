import { type DropdownItem } from '@lobehub/ui';
import { confirmModal, Icon, toast  } from '@lobehub/ui';
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
import { useElectronStore } from '@/store/electron';
import { pageActions, pageSelectors, usePageStore } from '@/store/page';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

interface ActionProps {
  pageId: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useDropdownMenu = ({ pageId, toggleEditing }: ActionProps): (() => DropdownItem[]) => {
  const { t } = useTranslation(['common', 'file']);

  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { allowed: canCreatePage } = usePermission('create_content');
  const { allowed: canEditPage } = usePermission('edit_own_content');
  const addTab = useElectronStore((s) => s.addTab);
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

  const handleDelete = useCallback(() => {
    if (!canEditPage) return;

    confirmModal({
      cancelText: t('cancel'),
      content: t('pageEditor.deleteConfirm.content', { ns: 'file' }),
      okButtonProps: { danger: true },
      okText: t('delete'),
      onOk: async () => {
        try {
          await pageActions.removePage(pageId);
          toast.success(t('pageEditor.deleteSuccess', { ns: 'file' }));
        } catch (error) {
          console.error('Failed to delete page:', error);
          toast.error(t('pageEditor.deleteError', { ns: 'file' }));
        }
      },
      title: t('pageEditor.deleteConfirm.title', { ns: 'file' }),
    });
  }, [canEditPage, pageId, t]);

  const handleDuplicate = useCallback(async () => {
    if (!canCreatePage) return;

    try {
      await pageActions.duplicatePage(pageId);
    } catch (error) {
      console.error('Failed to duplicate page:', error);
    }
  }, [canCreatePage, pageId]);

  const handlePublish = useCallback(() => {
    if (!canPublish) return;

    // Copy intentionally does not mention nested pages: Pages sidebar is a
    // flat list, so users can't see (and don't reliably know about) a
    // subtree — surfacing a "N sub-pages" count only creates confusion.
    // Visibility is changed only for this page; descendants stay independent.
    confirmModal({
      cancelText: t('cancel'),
      content: <VisibilityConfirmContent variant="publish" />,
      okText: t('continue'),
      onOk: async () => {
        try {
          await pageActions.publishPageToWorkspace(pageId);
          toast.success(t('pageList.publishSuccess', { ns: 'file' }));
        } catch (error) {
          console.error('Failed to publish page:', error);
          toast.error(t('pageList.publishError', { ns: 'file' }));
        }
      },
      title: t('pageList.publishConfirm.title', { ns: 'file' }),
    });
  }, [canPublish, pageId, t]);

  const handleMakePrivate = useCallback(() => {
    if (!canMakePrivate) return;
    confirmModal({
      cancelText: t('cancel'),
      content: <VisibilityConfirmContent variant="makePrivate" />,
      okButtonProps: { danger: true },
      okText: t('continue'),
      onOk: async () => {
        try {
          await pageActions.setPageVisibility(pageId, 'private');
          toast.success(t('makePrivate.success'));
        } catch (error) {
          console.error('Failed to make page private:', error);
          toast.error(t('makePrivate.error'));
        }
      },
      title: t('makePrivate.confirm.title'),
    });
  }, [canMakePrivate, pageId, t]);

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
          disabled: !canEditPage,
          icon: <Icon icon={Trash2} />,
          key: 'delete',
          label: t('delete'),
          onClick: handleDelete,
        },
      ].filter(Boolean) as DropdownItem[],
    [
      t,
      toggleEditing,
      handleDuplicate,
      handleDelete,
      handlePublish,
      handleMakePrivate,
      canCreatePage,
      canEditPage,
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
