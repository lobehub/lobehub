import { ActionIcon, type ActionIconProps, Dropdown } from '@lobehub/ui';
import { App } from 'antd';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserMemoryStore } from '@/store/userMemory';

interface PreferenceDropdownProps {
  id: string;
  size?: ActionIconProps['size'];
}

const PreferenceDropdown = memo<PreferenceDropdownProps>(({ id, size = 'small' }) => {
  const { t } = useTranslation(['memory', 'common']);
  const { modal } = App.useApp();

  const preferences = useUserMemoryStore((s) => s.preferences);
  const deletePreference = useUserMemoryStore((s) => s.deletePreference);
  const setEditingMemory = useUserMemoryStore((s) => s.setEditingMemory);

  const handleMenuClick = (info: { domEvent: MouseEvent | KeyboardEvent; key: string }) => {
    info.domEvent.stopPropagation();

    if (info.key === 'edit') {
      const preference = preferences.find((p) => p.id === id);
      if (preference) {
        setEditingMemory(id, preference.conclusionDirectives || '', 'preference');
      }
    } else if (info.key === 'delete') {
      modal.confirm({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('preference.deleteConfirm'),
        okButtonProps: { danger: true },
        okText: t('confirm', { ns: 'common' }),
        onOk: async () => {
          await deletePreference(id);
        },
        title: t('preference.deleteTitle'),
        type: 'warning',
      });
    }
  };

  const menuItems = [
    {
      icon: <Pencil size={14} />,
      key: 'edit',
      label: t('preference.actions.edit'),
    },
    {
      danger: true,
      icon: <Trash2 size={14} />,
      key: 'delete',
      label: t('preference.actions.delete'),
    },
  ];

  return (
    <Dropdown menu={{ items: menuItems, onClick: handleMenuClick }} trigger={['click']}>
      <ActionIcon icon={MoreHorizontal} size={size} />
    </Dropdown>
  );
});

export default PreferenceDropdown;
