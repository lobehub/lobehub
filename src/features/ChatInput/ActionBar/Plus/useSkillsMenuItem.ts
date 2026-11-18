import { type MenuItemType } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';

/** Hand off from the composer menu to the existing skill-selection sidebar. */
export const useSkillsMenuItem = (close: () => void) => {
  const { t } = useTranslation('chat');
  const openWorkingSidebar = useGlobalStore((s) => s.openWorkingSidebar);

  return {
    icon: SkillsIcon,
    key: 'skills',
    label: t('workingPanel.resources.filter.skills'),
    onClick: () => {
      close();
      openWorkingSidebar('skills');
    },
  } satisfies MenuItemType;
};
