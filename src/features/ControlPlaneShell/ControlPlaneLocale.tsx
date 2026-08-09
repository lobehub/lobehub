'use client';

import { ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import { memo, type PropsWithChildren, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { isRtlLang } from 'rtl-detect';

import { DEFAULT_LANG } from '@/const/locale';
import type { DayjsLocaleGlobEntry } from '@/utils/dayjsLocale';
import { loadDayjsLocaleModule, normalizeDayjsLocale } from '@/utils/dayjsLocale';
import { getAntdLocale } from '@/utils/locale';

import { createControlPlaneI18n } from './createControlPlaneI18n';

const dayjsLocaleLoaders: Record<string, DayjsLocaleGlobEntry> = {
  'ar': () => import('dayjs/locale/ar'),
  'de': () => import('dayjs/locale/de'),
  'en': () => import('dayjs/locale/en'),
  'es': () => import('dayjs/locale/es'),
  'fa': () => import('dayjs/locale/fa'),
  'fr': () => import('dayjs/locale/fr'),
  'ja': () => import('dayjs/locale/ja'),
  'ko': () => import('dayjs/locale/ko'),
  'ru': () => import('dayjs/locale/ru'),
  'zh-cn': () => import('dayjs/locale/zh-cn'),
  'zh-tw': () => import('dayjs/locale/zh-tw'),
};

const updateDayjs = async (lang: string) => {
  const locale = normalizeDayjsLocale(lang);
  const loader = dayjsLocaleLoaders[locale] ?? dayjsLocaleLoaders.en;
  const mod = await loadDayjsLocaleModule(loader!);
  dayjs.locale(mod.default);
};

interface ControlPlaneLocaleProps extends PropsWithChildren {
  defaultLang?: string;
}

const ControlPlaneLocale = memo<ControlPlaneLocaleProps>(({ children, defaultLang }) => {
  const [i18n] = useState(() => createControlPlaneI18n(defaultLang));
  const [lang, setLang] = useState(defaultLang ?? DEFAULT_LANG);
  const [antdLocale, setAntdLocale] = useState<any>();
  const [ready, setReady] = useState(i18n.instance.isInitialized);

  useEffect(() => {
    let canceled = false;
    void i18n.init({ initAsync: false }).then(() => {
      if (!canceled) setReady(true);
    });
    return () => {
      canceled = true;
    };
  }, [i18n]);

  useEffect(() => {
    if (!ready) return;

    const applyLocale = async (nextLang: string) => {
      setLang(nextLang);
      const [nextAntdLocale] = await Promise.all([getAntdLocale(nextLang), updateDayjs(nextLang)]);
      setAntdLocale(nextAntdLocale);
    };

    void applyLocale(i18n.instance.language || defaultLang || DEFAULT_LANG);
    i18n.instance.on('languageChanged', applyLocale);

    return () => {
      i18n.instance.off('languageChanged', applyLocale);
    };
  }, [defaultLang, i18n, ready]);

  if (!ready) return null;

  return (
    <I18nextProvider i18n={i18n.instance}>
      <ConfigProvider direction={isRtlLang(lang) ? 'rtl' : 'ltr'} locale={antdLocale}>
        {children}
      </ConfigProvider>
    </I18nextProvider>
  );
});

ControlPlaneLocale.displayName = 'ControlPlaneLocale';

export default ControlPlaneLocale;
