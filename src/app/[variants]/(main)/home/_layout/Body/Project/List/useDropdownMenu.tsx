import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { PencilLine, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useKnowledgeBaseStore } from '@/store/library';

interface ProjectItemDropdownMenuProps {
  id: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useProjectItemDropdownMenu = ({
  id,
  toggleEditing,
}: ProjectItemDropdownMenuProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['home', 'common']);
  const [removeKnowledgeBase] = useKnowledgeBaseStore((s) => [s.removeKnowledgeBase]);
  const { modal } = App.useApp();

  return useCallback(
    () => [
      {
        icon: <Icon icon={PencilLine} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: () => {
          toggleEditing(true);
        },
      },
      {
        type: 'divider',
      },
      {
        danger: true,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: () => {
          if (!id) return;
          modal.confirm({
            centered: true,
            okButtonProps: { danger: true },
            onOk: async () => {
              await removeKnowledgeBase(id);
            },
            title: t('project.deleteConfirm'),
          });
        },
      },
    ],
    [t, id, modal, removeKnowledgeBase, toggleEditing],
  );
};
