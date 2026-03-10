import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

interface UseDropdownMenuProps {
  onClose: () => void;
  topicId: string;
  topicTitle: string;
}

export const useDropdownMenu = ({
  onClose,
  topicId,
}: UseDropdownMenuProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['common', 'topic']);
  const { modal } = App.useApp();
  const removeTopic = useChatStore((s) => s.removeTopic);

  const handleDelete = () => {
    modal.confirm({
      cancelText: t('cancel'),
      centered: true,
      content: t('actions.confirmRemoveTopic', { ns: 'topic' }),
      okButtonProps: { danger: true },
      okText: t('delete'),
      onOk: async () => {
        await removeTopic(topicId);
        onClose();
      },
      title: t('delete'),
    });
  };

  return useCallback(
    () =>
      [
        {
          danger: true,
          icon: <Icon icon={Trash2} />,
          key: 'delete',
          label: t('delete'),
          onClick: handleDelete,
        },
      ].filter(Boolean) as MenuProps['items'],
    [t, handleDelete],
  );
};
