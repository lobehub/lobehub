import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { FileText, PencilLine, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useKnowledgeBaseTransferMenuItem } from '@/business/client/hooks/useKnowledgeBaseTransferMenuItem';
import { useCreateNewModal } from '@/features/LibraryModal';
import { usePermission } from '@/hooks/usePermission';
import { useKnowledgeBaseStore } from '@/store/library';

interface ActionProps {
  description?: string | null;
  id: string;
  name: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useDropdownMenu = ({
  id,
  name,
  description,
  toggleEditing,
}: ActionProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['file', 'common']);
  const removeKnowledgeBase = useKnowledgeBaseStore((s) => s.removeKnowledgeBase);
  const { open } = useCreateNewModal();
  const { allowed: canEdit } = usePermission('edit_own_content');
  const transferMenuItems = useKnowledgeBaseTransferMenuItem(id);

  const handleDelete = useCallback(() => {
    if (!canEdit) return;
    if (!id) return;

    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('library.list.confirmRemoveLibrary'),
      okButtonProps: { danger: true },
      okText: t('delete', { ns: 'common' }),
      onOk: async () => {
        await removeKnowledgeBase(id);
      },
      title: t('header.actions.deleteLibrary'),
    });
  }, [canEdit, id, removeKnowledgeBase, t]);

  const handleEditDescription = useCallback(() => {
    if (!canEdit) return;
    open({
      id,
      initialValues: { description: description || '', name },
    });
  }, [canEdit, description, id, name, open]);

  return useCallback(
    () =>
      [
        {
          disabled: !canEdit,
          icon: <Icon icon={PencilLine} />,
          key: 'rename',
          label: t('rename', { ns: 'common' }),
          onClick: (info: any) => {
            info.domEvent?.stopPropagation();
            toggleEditing(true);
          },
        },
        {
          disabled: !canEdit,
          icon: <Icon icon={FileText} />,
          key: 'editDescription',
          label: t('edit', { ns: 'common' }),
          onClick: (info: any) => {
            info.domEvent?.stopPropagation();
            handleEditDescription();
          },
        },
        ...(canEdit ? (transferMenuItems ?? []) : []),
        { type: 'divider' },
        {
          danger: true,
          disabled: !canEdit,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: handleDelete,
        },
      ].filter(Boolean) as MenuProps['items'],
    [canEdit, t, toggleEditing, handleDelete, handleEditDescription, transferMenuItems],
  );
};
