import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { CopyPlus, Pencil, Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { message, modal } = App.useApp();
  const removePage = usePageStore((s) => s.removePage);
  const duplicatePage = usePageStore((s) => s.duplicatePage);

  const handleDelete = () => {
    modal.confirm({
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
    try {
      await duplicatePage(pageId);
    } catch (error) {
      console.error('Failed to duplicate page:', error);
    }
  };

  return useCallback(
    () =>
      [
        {
          icon: <Icon icon={Pencil} />,
          key: 'rename',
          label: t('rename'),
          onClick: () => toggleEditing(true),
        },
        {
          icon: <Icon icon={CopyPlus} />,
          key: 'duplicate',
          label: t('pageList.duplicate', { ns: 'file' }),
          onClick: handleDuplicate,
        },
        { type: 'divider' },
        {
          danger: true,
          icon: <Icon icon={Trash2} />,
          key: 'delete',
          label: t('delete'),
          onClick: handleDelete,
        },
      ].filter(Boolean) as MenuProps['items'],
    [t, toggleEditing, handleDuplicate, handleDelete],
  );
};
