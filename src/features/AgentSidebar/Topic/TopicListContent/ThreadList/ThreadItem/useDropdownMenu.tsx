import { type DropdownItem } from '@lobehub/ui';
import { confirmModal,Icon  } from '@lobehub/ui';
import { PanelRight, PencilLine, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';

interface ThreadItemDropdownMenuProps {
  id: string;
  sourceMessageId?: string;
  title: string;
}

export const useThreadItemDropdownMenu = ({
  id,
  sourceMessageId,
  title,
}: ThreadItemDropdownMenuProps): (() => DropdownItem[]) => {
  const { t } = useTranslation(['thread', 'common']);
  const { allowed: canEditThread } = usePermission('edit_own_content');

  const [removeThread, openThreadInPortal, updateThreadTitle] = useChatStore((s) => [
    s.removeThread,
    s.openThreadInPortal,
    s.updateThreadTitle,
  ]);

  return useCallback(() => {
    return [
      {
        icon: <Icon icon={PanelRight} />,
        key: 'openOnRight',
        label: t('openOnRight', { ns: 'common' }),
        onClick: () => {
          openThreadInPortal(id, sourceMessageId);
        },
      },
      {
        type: 'divider' as const,
      },
      {
        disabled: !canEditThread,
        icon: <Icon icon={PencilLine} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: () => {
          openRenameModal({
            defaultValue: title,
            onSave: (newTitle) => updateThreadTitle(id, newTitle),
          });
        },
        sfSymbol: 'pencil',
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
        sfSymbol: 'trash',
      },
    ].filter(Boolean) as DropdownItem[];
  }, [
    id,
    sourceMessageId,
    canEditThread,
    removeThread,
    openThreadInPortal,
    title,
    updateThreadTitle,
    t,
  ]);
};
