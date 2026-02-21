import { type ActionIconProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { App } from 'antd';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserMemoryStore } from '@/store/userMemory';

interface ActivityDropdownProps {
  id: string;
  size?: ActionIconProps['size'];
}

const ActivityDropdown = memo<ActivityDropdownProps>(({ id, size = 'small' }) => {
  const { t } = useTranslation(['memory', 'common']);
  const { modal } = App.useApp();

  const activities = useUserMemoryStore((s) => s.activities);
  const deleteActivity = useUserMemoryStore((s) => s.deleteActivity);
  const setEditingMemory = useUserMemoryStore((s) => s.setEditingMemory);

  const handleMenuClick = (info: { domEvent: MouseEvent | KeyboardEvent; key: string }) => {
    info.domEvent.stopPropagation();

    if (info.key === 'edit') {
      const activity = activities.find((item) => item.id === id);
      if (activity) {
        setEditingMemory(id, activity.narrative || activity.notes || '', 'activity');
      }
    } else if (info.key === 'delete') {
      modal.confirm({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('activity.deleteConfirm'),
        okButtonProps: { danger: true },
        okText: t('confirm', { ns: 'common' }),
        onOk: async () => {
          await deleteActivity(id);
        },
        title: t('activity.deleteTitle'),
        type: 'warning',
      });
    }
  };

  const menuItems = [
    {
      icon: <Pencil size={14} />,
      key: 'edit',
      label: t('activity.actions.edit'),
      onClick: handleMenuClick,
    },
    {
      danger: true,
      icon: <Trash2 size={14} />,
      key: 'delete',
      label: t('activity.actions.delete'),
      onClick: handleMenuClick,
    },
  ];

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontal} size={size} />
    </DropdownMenu>
  );
});

export default ActivityDropdown;
