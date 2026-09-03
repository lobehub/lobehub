'use client';

import { DropdownMenu, type DropdownMenuCheckboxItem, Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { GlobeIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { localeOptions, normalizeLocale } from '@/locales/resources';

const setCookieSimple = (key: string, value: string, days: number) => {
  const expires = new Date(Date.now() + days * 86_400_000).toUTCString();
  document.cookie = `${key}=${value};expires=${expires};path=/;`;
};

const AuthLangButton = memo(() => {
  const { i18n } = useTranslation();
  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  const current = normalizeLocale(i18n.resolvedLanguage || i18n.language || browserLanguage);
  const currentLabel = localeOptions.find((item) => item.value === current)?.label || 'English';

  const items = useMemo<DropdownMenuCheckboxItem[]>(
    () =>
      localeOptions.map((item) => ({
        checked: current === item.value,
        closeOnClick: true,
        key: item.value,
        label: (
          <Flexbox gap={4} key={item.value}>
            <Text style={{ lineHeight: 1.2 }}>{item.label}</Text>
          </Flexbox>
        ),
        onCheckedChange: (checked: boolean) => {
          if (!checked) return;
          i18n.changeLanguage(item.value);
          document.documentElement.lang = item.value;
          setCookieSimple(LOBE_LOCALE_COOKIE, item.value, 365);
        },
        type: 'checkbox',
      })),
    [current, i18n],
  );

  return (
    <DropdownMenu
      items={items}
      popupProps={{
        style: {
          maxHeight: 360,
          minWidth: 200,
          overflow: 'auto',
        },
      }}
    >
      <Button
        icon={GlobeIcon}
        iconPosition="end"
        size="small"
        type="text"
        style={{
          height: 32,
          paddingInline: 8,
        }}
      >
        <Text fontSize={12}>{currentLabel}</Text>
      </Button>
    </DropdownMenu>
  );
});

AuthLangButton.displayName = 'AuthLangButton';

export default AuthLangButton;
