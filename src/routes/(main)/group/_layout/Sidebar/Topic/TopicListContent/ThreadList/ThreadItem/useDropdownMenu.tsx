import { type DropdownItem } from '@lobehub/ui';
import { confirmModal, Icon } from '@lobehub/ui';
import { PencilLine, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';

interface ThreadItemDropdownMenuProps {
  /**
   * Subagent threads are the expanded detail of their parent tool call and are
   * cleaned up with their topic, so they pass `false` to drop delete.
   */
  deletable?: boolean;
  id: string;
  title: string;
}

export const useThreadItemDropdownMenu = ({
  deletable = true,
  id,
  title,
}: ThreadItemDropdownMenuProps): (() => DropdownItem[]) => {
  const { t } = useTranslation(['thread', 'common']);
  const { allowed: canEditThread } = usePermission('edit_own_content');

  const [removeThread, updateThreadTitle] = useChatStore((s) => [
    s.removeThread,
    s.updateThreadTitle,
  ]);

  return useCallback(() => {
    return [
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
      ...(deletable
        ? [
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
          ]
        : []),
    ].filter(Boolean) as DropdownItem[];
  }, [id, canEditThread, deletable, removeThread, title, updateThreadTitle, t]);
};
