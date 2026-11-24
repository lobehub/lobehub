import { type MenuItemType } from '@lobehub/ui';
import { WrenchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';

/** Hand off from the composer menu to the right-side tools sidebar. */
export const useToolsMenuItem = (close: () => void) => {
  const { t } = useTranslation('setting');
  const openWorkingSidebar = useGlobalStore((s) => s.openWorkingSidebar);

  return {
    icon: WrenchIcon,
    key: 'tools',
    label: t('tools.picker.title'),
    onClick: () => {
      close();
      openWorkingSidebar('tools');
    },
  } satisfies MenuItemType;
};
