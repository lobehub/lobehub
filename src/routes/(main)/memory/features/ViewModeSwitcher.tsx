'use client';

import { ActionIcon } from '@lobehub/ui';
import { CalendarDaysIcon, LayoutDashboardIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type ViewMode } from '@/features/Memory';
import { useHeaderActionSize } from '@/styles/density';

export type { ViewMode } from '@/features/Memory';

interface ViewModeSwitcherProps {
  onChange: (mode: ViewMode) => void;
  value: ViewMode;
}

const ViewModeSwitcher = memo<ViewModeSwitcherProps>(({ value, onChange }) => {
  const { t } = useTranslation('memory');
  const headerActionSmallSize = useHeaderActionSize(true);

  return (
    <>
      <ActionIcon
        active={value === 'timeline'}
        icon={CalendarDaysIcon}
        size={headerActionSmallSize}
        title={t('viewMode.timeline')}
        onClick={() => onChange('timeline')}
      />
      <ActionIcon
        active={value === 'grid'}
        icon={LayoutDashboardIcon}
        size={headerActionSmallSize}
        title={t('viewMode.masonry')}
        onClick={() => onChange('grid')}
      />
    </>
  );
});

export default ViewModeSwitcher;
