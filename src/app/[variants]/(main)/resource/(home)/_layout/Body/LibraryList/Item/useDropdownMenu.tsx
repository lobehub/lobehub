import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { PencilLine, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useKnowledgeBaseStore } from '@/store/library';

interface ActionProps {
  id: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useDropdownMenu = ({ id, toggleEditing }: ActionProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['file', 'common']);
  const { modal } = App.useApp();
  const removeKnowledgeBase = useKnowledgeBaseStore((s) => s.removeKnowledgeBase);

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
        { type: 'divider' },
        {
          danger: true,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: handleDelete,
        },
      ].filter(Boolean) as MenuProps['items'],
    [t, id, modal, removeKnowledgeBase, toggleEditing, handleDelete],
  );
};
