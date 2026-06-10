import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';

interface UseDropdownMenuProps {
  agentId: string;
  agentTitle: string;
  isBuiltinAgent: boolean;
  onClose: () => void;
}

export const useDropdownMenu = ({
  agentId,
  isBuiltinAgent,
  onClose,
}: UseDropdownMenuProps): MenuProps['items'] => {
  const { t } = useTranslation(['common', 'chat']);
  const removeAgent = useHomeStore((s) => s.removeAgent);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const handleDelete = () => {
    if (!canEdit) return;

    confirmModal({
      cancelText: t('cancel'),
      content: t('confirmRemoveSessionItemAlert', { ns: 'chat' }),
      okButtonProps: { danger: true },
      okText: t('delete'),
      onOk: async () => {
        await removeAgent(agentId);
        onClose();
      },
      title: t('delete'),
    });
  };

  return useMemo(() => {
    if (isBuiltinAgent) return [];

    return [
      {
        danger: true,
        disabled: !canEdit,
        icon: <Icon icon={Trash2} />,
        key: 'delete',
        label: t('delete'),
        onClick: handleDelete,
      },
    ].filter(Boolean) as MenuProps['items'];
  }, [canEdit, t, isBuiltinAgent, handleDelete]);
};
