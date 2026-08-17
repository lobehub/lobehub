'use client';

import { ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import { memo, type PropsWithChildren, useEffect, useState } from 'react';
import { isRtlLang } from 'rtl-detect';

import type { DayjsLocaleGlobEntry } from '@/utils/dayjsLocale';
import { loadDayjsLocaleModule, normalizeDayjsLocale } from '@/utils/dayjsLocale';
import { getAntdLocale } from '@/utils/locale';

import { createWorkbenchI18n } from './createWorkbenchI18n';

const dayjsLocaleLoaders: Record<string, DayjsLocaleGlobEntry> = {
  'ar': () => import('dayjs/locale/ar'),
  'bg': () => import('dayjs/locale/bg'),
  'de': () => import('dayjs/locale/de'),
  'en': () => import('dayjs/locale/en'),
  'es': () => import('dayjs/locale/es'),
  'fa': () => import('dayjs/locale/fa'),
  'fr': () => import('dayjs/locale/fr'),
  'it': () => import('dayjs/locale/it'),
  'ja': () => import('dayjs/locale/ja'),
  'ko': () => import('dayjs/locale/ko'),
  'nl': () => import('dayjs/locale/nl'),
  'pl': () => import('dayjs/locale/pl'),
  'pt-br': () => import('dayjs/locale/pt-br'),
  'ru': () => import('dayjs/locale/ru'),
  'tr': () => import('dayjs/locale/tr'),
  'vi': () => import('dayjs/locale/vi'),
  'zh-cn': () => import('dayjs/locale/zh-cn'),
  'zh-tw': () => import('dayjs/locale/zh-tw'),
};

const updateDayjs = async (lang: string) => {
  const locale = normalizeDayjsLocale(lang);
  const loader = dayjsLocaleLoaders[locale] ?? dayjsLocaleLoaders.en;
  const mod = await loadDayjsLocaleModule(loader!);

  dayjs.locale(mod.default);
};

interface WorkbenchLocaleProps extends PropsWithChildren {
  defaultLang?: string;
}

const WorkbenchLocale = memo<WorkbenchLocaleProps>(({ children, defaultLang }) => {
  const [i18n] = useState(() => createWorkbenchI18n(defaultLang));
  const [lang, setLang] = useState(defaultLang ?? 'en-US');
  const [antdLocale, setAntdLocale] = useState<any>();

  if (!i18n.instance.isInitialized) void i18n.init();

  useEffect(() => {
    const applyLocale = async (nextLang: string) => {
      setLang(nextLang);
      const [nextAntdLocale] = await Promise.all([getAntdLocale(nextLang), updateDayjs(nextLang)]);
      setAntdLocale(nextAntdLocale);
    };

    void applyLocale(i18n.instance.language || defaultLang || 'en-US');
    i18n.instance.on('languageChanged', applyLocale);

    return () => {
      i18n.instance.off('languageChanged', applyLocale);
    };
  }, [defaultLang, i18n]);

  return (
    <ConfigProvider direction={isRtlLang(lang) ? 'rtl' : 'ltr'} locale={antdLocale}>
      {children}
    </ConfigProvider>
  );
});

WorkbenchLocale.displayName = 'WorkbenchLocale';

export default WorkbenchLocale;
