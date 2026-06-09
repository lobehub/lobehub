import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { PencilLine, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';

interface ThreadItemDropdownMenuProps {
  id: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useThreadItemDropdownMenu = ({
  id,
  toggleEditing,
}: ThreadItemDropdownMenuProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['thread', 'common']);
  const { allowed: canEditThread } = usePermission('edit_own_content');

  const [removeThread] = useChatStore((s) => [s.removeThread]);

  return useCallback(() => {
    return [
      {
        disabled: !canEditThread,
        icon: <Icon icon={PencilLine} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: () => {
          toggleEditing(true);
        },
      },
      {
        type: 'divider' as const,
      },
      {
        danger: true,
        disabled: !canEditThread,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: () => {
          confirmModal({
            cancelText: t('cancel', { ns: 'common' }),
            content: t('actions.confirmRemoveThread'),
            okButtonProps: { danger: true },
            okText: t('delete', { ns: 'common' }),
            onOk: async () => {
              await removeThread(id);
            },
            title: t('delete', { ns: 'common' }),
          });
        },
      },
    ].filter(Boolean) as MenuProps['items'];
  }, [id, canEditThread, removeThread, toggleEditing, t]);
};
