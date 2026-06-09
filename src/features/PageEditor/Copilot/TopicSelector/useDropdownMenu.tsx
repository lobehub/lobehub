import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

interface UseDropdownMenuProps {
  onClose: () => void;
  onDelete?: (topicId: string) => void;
  topicId: string;
  topicTitle: string;
}

export const useDropdownMenu = ({
  onClose,
  onDelete,
  topicId,
}: UseDropdownMenuProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['common', 'topic']);
  const removeTopic = useChatStore((s) => s.removeTopic);

  return useCallback(
    () =>
      [
        {
          danger: true,
          icon: <Icon icon={Trash2} />,
          key: 'delete',
          label: t('delete'),
          onClick: () => {
            confirmModal({
              cancelText: t('cancel'),
              content: t('actions.confirmRemoveTopic', { ns: 'topic' }),
              okButtonProps: { danger: true },
              okText: t('delete'),
              onOk: async () => {
                await removeTopic(topicId);
                onDelete?.(topicId);
                onClose();
              },
              title: t('delete'),
            });
          },
        },
      ].filter(Boolean) as MenuProps['items'],
    [t, removeTopic, topicId, onDelete, onClose],
  );
};
