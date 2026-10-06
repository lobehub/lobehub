// Fixture: loading a locale chunk is code loading, not server data.
import { ConfigProvider } from 'antd';
import type { Locale } from 'antd/es/locale';
import { memo, type PropsWithChildren, useEffect, useState } from 'react';

import { getAntdLocale } from '@/utils/locale';

const LocaleProvider = memo<PropsWithChildren<{ lang: string }>>(({ children, lang }) => {
  const [locale, setLocale] = useState<Locale>();

  useEffect(() => {
    let active = true;
    getAntdLocale(lang).then((next) => {
      if (active) setLocale(next);
    });
    return () => {
      active = false;
    };
  }, [lang]);

  return <ConfigProvider locale={locale}>{children}</ConfigProvider>;
});

export default LocaleProvider;
