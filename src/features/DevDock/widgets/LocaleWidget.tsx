'use client';

import { DropdownMenu, type DropdownMenuCheckboxItem } from '@lobehub/ui/base-ui';
import { Languages } from 'lucide-react';
import { memo, useMemo } from 'react';

import { localeOptions } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import type { LocaleMode } from '@/types/locale';

import { barButtonStyles } from './BarButton';

const LocaleWidget = memo(() => {
  const language = useGlobalStore(globalGeneralSelectors.language);
  const switchLocale = useGlobalStore((s) => s.switchLocale);

  const items = useMemo<DropdownMenuCheckboxItem[]>(() => {
    const options: { label: string; value: LocaleMode }[] = [
      { label: 'Follow system', value: 'auto' },
      ...localeOptions.map((item) => ({ label: item.label, value: item.value })),
    ];

    return options.map((option) => ({
      checked: language === option.value,
      closeOnClick: true,
      key: option.value,
      // Dev tool — the locale code is what you actually want to read here, the
      // native name is only there to tell the CJK variants apart at a glance.
      label: `${option.value} · ${option.label}`,
      onCheckedChange: (checked: boolean) => {
        if (checked) switchLocale(option.value);
      },
      type: 'checkbox' as const,
    }));
  }, [language, switchLocale]);

  return (
    <DropdownMenu
      items={items}
      placement={'topLeft'}
      popupProps={{ style: { maxHeight: 360, minWidth: 180, overflow: 'auto' } }}
    >
      <span className={barButtonStyles.button} title={'Switch language'}>
        <Languages size={11} />
        <span>{language}</span>
      </span>
    </DropdownMenu>
  );
});

LocaleWidget.displayName = 'DevDockLocaleWidget';

export default LocaleWidget;
