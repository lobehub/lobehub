import { type DropdownItem } from '@lobehub/ui';
import { confirmModal, Icon, toast } from '@lobehub/ui';
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

/**
 * `DropdownMenu` / `ContextMenu` hand each item an `info` object carrying the
 * originating DOM event (the published `DropdownItem.onClick` type says
 * `MouseEventHandler`, the runtime contract does not).
 */
interface MenuClickInfo {
  domEvent?: { stopPropagation: () => void };
}

/**
 * A page row is itself a link, so a menu click that keeps bubbling runs the
 * row's own `onClick` and navigates away. That unmounts the row — and the inline
 * rename field with it — before anything can be typed, which is why "Rename"
 * appeared to do nothing. Close the handler over the row and stop the event.
 */
const stopRowClick =
  (run: () => void) =>
  (info?: MenuClickInfo) => {
    info?.domEvent?.stopPropagation();
    run();
  };

/**
 * Business builds inject their own transfer entries (Move to a library, …).
 * They arrive with the caller's plain `onClick`, so they have to go through the
 * same wrapper — otherwise choosing one of them still reaches the row link and
 * navigates away, which is the exact defect the local actions no longer have.
 */
const wrapMenuItems = (items: DropdownItem[] | undefined | null): DropdownItem[] =>
  (items ?? []).map((item) =>
    item && 'onClick' in item && typeof item.onClick === 'function'
      ? ({ ...item, onClick: stopRowClick(item.onClick as () => void) } as DropdownItem)
      : item,
  );

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
                onClick: stopRowClick(() => {
                  const url = buildWorkspaceAwarePath(`/page/${pageId}`, activeWorkspaceSlug);
                  addTab(url);
                  navigate(url, { escape: true });
                }),
              },
              { type: 'divider' as const },
            ]
          : []),
        {
          disabled: !canEditPage,
          icon: <Icon icon={Pencil} />,
          key: 'rename',
          label: t('rename'),
          onClick: stopRowClick(() => {
            if (!canEditPage) return;
            toggleEditing(true);
          }),
        },
        {
          disabled: !canCreatePage,
          icon: <Icon icon={CopyPlus} />,
          key: 'duplicate',
          label: t('pageList.duplicate', { ns: 'file' }),
          onClick: stopRowClick(handleDuplicate),
        },
        ...(transferMenuItems && transferMenuItems.length > 0
          ? [{ type: 'divider' as const }, ...wrapMenuItems(transferMenuItems)]
          : []),
        ...(canPublish
          ? [
              { type: 'divider' as const },
              {
                icon: <Icon icon={UsersIcon} />,
                key: 'publishToWorkspace',
                label: t('pageList.publishToWorkspace', { ns: 'file' }),
                onClick: stopRowClick(handlePublish),
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
                onClick: stopRowClick(handleMakePrivate),
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
          onClick: stopRowClick(handleDelete),
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
