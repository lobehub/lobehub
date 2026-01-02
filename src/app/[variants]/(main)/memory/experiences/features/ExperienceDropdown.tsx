import { ActionIcon, type ActionIconProps, Dropdown } from '@lobehub/ui';
import { App } from 'antd';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserMemoryStore } from '@/store/userMemory';

interface ExperienceDropdownProps {
  id: string;
  size?: ActionIconProps['size'];
}

const ExperienceDropdown = memo<ExperienceDropdownProps>(({ id, size = 'small' }) => {
  const { t } = useTranslation(['memory', 'common']);
  const { modal } = App.useApp();

  const experiences = useUserMemoryStore((s) => s.experiences);
  const deleteExperience = useUserMemoryStore((s) => s.deleteExperience);
  const setEditingMemory = useUserMemoryStore((s) => s.setEditingMemory);

  const handleMenuClick = (info: { domEvent: MouseEvent | KeyboardEvent; key: string }) => {
    info.domEvent.stopPropagation();

    if (info.key === 'edit') {
      const experience = experiences.find((e) => e.id === id);
      if (experience) {
        setEditingMemory(id, experience.keyLearning || '', 'experience');
      }
    } else if (info.key === 'delete') {
      modal.confirm({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('experience.deleteConfirm'),
        okButtonProps: { danger: true },
        okText: t('confirm', { ns: 'common' }),
        onOk: async () => {
          await deleteExperience(id);
        },
        title: t('experience.deleteTitle'),
        type: 'warning',
      });
    }
  };

  const menuItems = [
    {
      icon: <Pencil size={14} />,
      key: 'edit',
      label: t('experience.actions.edit'),
    },
    {
      danger: true,
      icon: <Trash2 size={14} />,
      key: 'delete',
      label: t('experience.actions.delete'),
    },
  ];

  return (
    <Dropdown menu={{ items: menuItems, onClick: handleMenuClick }} trigger={['click']}>
      <ActionIcon icon={MoreHorizontal} size={size} />
    </Dropdown>
  );
});

export default ExperienceDropdown;
