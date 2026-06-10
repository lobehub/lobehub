import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { CopyPlus, PanelTop, Pencil, Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useDocumentTransferMenuItem } from '@/business/client/hooks/useDocumentTransferMenuItem';
import { isDesktop } from '@/const/version';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useElectronStore } from '@/store/electron';
import { usePageStore } from '@/store/page';

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
  const { allowed: canCreatePage } = usePermission('create_content');
  const { allowed: canEditPage } = usePermission('edit_own_content');
  const addTab = useElectronStore((s) => s.addTab);
  const removePage = usePageStore((s) => s.removePage);
  const duplicatePage = usePageStore((s) => s.duplicatePage);
  const transferMenuItems = useDocumentTransferMenuItem(pageId);

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
                  const url = `/page/${pageId}`;
                  addTab(url);
                  navigate(url);
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
        ...(transferMenuItems ?? []),
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
      canCreatePage,
      canEditPage,
      pageId,
      addTab,
      navigate,
      transferMenuItems,
    ],
  );
};
