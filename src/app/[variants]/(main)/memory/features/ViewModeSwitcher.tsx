'use client';

import { ActionIcon } from '@lobehub/ui';
import { CalendarDaysIcon, LayoutDashboardIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';

export type ViewMode = 'timeline' | 'grid';

interface ViewModeSwitcherProps {
  onChange: (mode: ViewMode) => void;
  value: ViewMode;
}

const ViewModeSwitcher = memo<ViewModeSwitcherProps>(({ value, onChange }) => {
  const { t } = useTranslation('memory');

  return (
    <>
      <ActionIcon
        active={value === 'timeline'}
        icon={CalendarDaysIcon}
        onClick={() => onChange('timeline')}
        size={DESKTOP_HEADER_ICON_SIZE}
        title={t('viewMode.timeline')}
      />
      <ActionIcon
        active={value === 'grid'}
        icon={LayoutDashboardIcon}
        onClick={() => onChange('grid')}
        size={DESKTOP_HEADER_ICON_SIZE}
        title={t('viewMode.masonry')}
      />
    </>
  );
});

export default ViewModeSwitcher;
