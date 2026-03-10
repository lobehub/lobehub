import { type ActionIconProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { App } from 'antd';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserMemoryStore } from '@/store/userMemory';

interface IdentityDropdownProps {
  id: string;
  size?: ActionIconProps['size'];
}

const IdentityDropdown = memo<IdentityDropdownProps>(({ id, size = 'small' }) => {
  const { t } = useTranslation(['memory', 'common']);
  const { modal } = App.useApp();

  const identities = useUserMemoryStore((s) => s.identities);
  const deleteIdentity = useUserMemoryStore((s) => s.deleteIdentity);
  const setEditingMemory = useUserMemoryStore((s) => s.setEditingMemory);

  const handleMenuClick = (info: { domEvent: MouseEvent | KeyboardEvent; key: string }) => {
    info.domEvent.stopPropagation();

    if (info.key === 'edit') {
      const identity = identities.find((i) => i.id === id);
      if (identity) {
        setEditingMemory(id, identity.description || '', 'identity');
      }
    } else if (info.key === 'delete') {
      modal.confirm({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('identity.list.deleteContent'),
        okButtonProps: { danger: true },
        okText: t('delete', { ns: 'common' }),
        onOk: async () => {
          await deleteIdentity(id);
        },
        title: t('identity.list.confirmDelete'),
        type: 'warning',
      });
    }
  };

  const menuItems = [
    {
      icon: <Pencil size={14} />,
      key: 'edit',
      label: t('edit', { ns: 'common' }),
      onClick: handleMenuClick,
    },
    {
      danger: true,
      icon: <Trash2 size={14} />,
      key: 'delete',
      label: t('delete', { ns: 'common' }),
      onClick: handleMenuClick,
    },
  ];

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontal} size={size} />
    </DropdownMenu>
  );
});

export default IdentityDropdown;
