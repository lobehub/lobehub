import { ActionIcon, type ActionIconProps, Dropdown } from '@lobehub/ui';
import { App } from 'antd';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserMemoryStore } from '@/store/userMemory';

interface ContextDropdownProps {
  id: string;
  size?: ActionIconProps['size'];
}

const ContextDropdown = memo<ContextDropdownProps>(({ id, size = 'small' }) => {
  const { t } = useTranslation(['memory', 'common']);
  const { modal } = App.useApp();

  const contexts = useUserMemoryStore((s) => s.contexts);
  const deleteContext = useUserMemoryStore((s) => s.deleteContext);
  const setEditingMemory = useUserMemoryStore((s) => s.setEditingMemory);

  const handleMenuClick = (info: { domEvent: MouseEvent | KeyboardEvent; key: string }) => {
    info.domEvent.stopPropagation();

    if (info.key === 'edit') {
      const context = contexts.find((c) => c.id === id);
      if (context) {
        setEditingMemory(id, context.description || '', 'context');
      }
    } else if (info.key === 'delete') {
      modal.confirm({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('context.deleteConfirm'),
        okButtonProps: { danger: true },
        okText: t('confirm', { ns: 'common' }),
        onOk: async () => {
          await deleteContext(id);
        },
        title: t('context.deleteTitle'),
        type: 'warning',
      });
    }
  };

  const menuItems = [
    {
      icon: <Pencil size={14} />,
      key: 'edit',
      label: t('context.actions.edit'),
    },
    {
      danger: true,
      icon: <Trash2 size={14} />,
      key: 'delete',
      label: t('context.actions.delete'),
    },
  ];

  return (
    <Dropdown menu={{ items: menuItems, onClick: handleMenuClick }} trigger={['click']}>
      <ActionIcon icon={MoreHorizontal} size={size} />
    </Dropdown>
  );
});

export default ContextDropdown;
