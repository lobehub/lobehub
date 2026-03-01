import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { FileText, PencilLine, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateNewModal } from '@/features/LibraryModal';
import { useKnowledgeBaseStore } from '@/store/library';

interface ActionProps {
  description?: string | null;
  id: string;
  name: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useDropdownMenu = ({ id, name, description, toggleEditing }: ActionProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['file', 'common']);
  const { modal } = App.useApp();
  const removeKnowledgeBase = useKnowledgeBaseStore((s) => s.removeKnowledgeBase);
  const { open } = useCreateNewModal();

  const handleDelete = () => {
    if (!id) return;

    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        await removeKnowledgeBase(id);
      },
      title: t('library.list.confirmRemoveLibrary'),
    });
  };

  const handleEditDescription = () => {
    open({
      id,
      initialValues: { description: description || '', name },
    });
  };

  return useCallback(
    () =>
      [
        {
          icon: <Icon icon={PencilLine} />,
          key: 'rename',
          label: t('rename', { ns: 'common' }),
          onClick: (info: any) => {
            info.domEvent?.stopPropagation();
            toggleEditing(true);
          },
        },
        {
          icon: <Icon icon={FileText} />,
          key: 'editDescription',
          label: t('edit', { ns: 'common' }),
          onClick: (info: any) => {
            info.domEvent?.stopPropagation();
            handleEditDescription();
          },
        },
        { type: 'divider' },
        {
          danger: true,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: handleDelete,
        },
      ].filter(Boolean) as MenuProps['items'],
    [t, id, name, description, modal, removeKnowledgeBase, toggleEditing, handleDelete, handleEditDescription, open],
  );
};
