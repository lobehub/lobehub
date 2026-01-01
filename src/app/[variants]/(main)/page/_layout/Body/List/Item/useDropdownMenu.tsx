import { Icon, type MenuProps } from '@lobehub/ui';
import { App } from 'antd';
import { Copy, CopyPlus, Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';

interface ActionProps {
  documentContent?: string;
  pageId: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useDropdownMenu = ({
  documentContent,
  pageId,
  toggleEditing,
}: ActionProps): MenuProps['items'] => {
  const { t } = useTranslation(['common', 'file']);
  const { message, modal } = App.useApp();
  const removeDocument = useFileStore((s) => s.removeDocument);
  const duplicateDocument = useFileStore((s) => s.duplicateDocument);

  const handleDelete = () => {
    modal.confirm({
      cancelText: t('cancel'),
      content: t('pageEditor.deleteConfirm.content', { ns: 'file' }),
      okButtonProps: { danger: true },
      okText: t('delete'),
      onOk: async () => {
        try {
          await removeDocument(pageId);
          message.success(t('pageEditor.deleteSuccess', { ns: 'file' }));
        } catch (error) {
          console.error('Failed to delete page:', error);
          message.error(t('pageEditor.deleteError', { ns: 'file' }));
        }
      },
      title: t('pageEditor.deleteConfirm.title', { ns: 'file' }),
    });
  };

  const handleCopy = async () => {
    if (documentContent) {
      try {
        await navigator.clipboard.writeText(documentContent);
      } catch (error) {
        console.error('Failed to copy page:', error);
      }
    }
  };

  const handleDuplicate = async () => {
    try {
      await duplicateDocument(pageId);
    } catch (error) {
      console.error('Failed to duplicate page:', error);
    }
  };

  return useMemo(
    () =>
      [
        {
          icon: <Icon icon={Pencil} />,
          key: 'rename',
          label: t('rename'),
          onClick: () => toggleEditing(true),
        },
        {
          icon: <Icon icon={Copy} />,
          key: 'copy',
          label: t('pageList.copyContent', { ns: 'file' }),
          onClick: handleCopy,
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
    [t, toggleEditing, handleCopy, handleDuplicate, handleDelete],
  );
};
