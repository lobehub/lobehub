'use client';

import dayjs from 'dayjs';
import { memo, type PropsWithChildren, useEffect, useState } from 'react';

import type { DayjsLocaleGlobEntry } from '@/utils/dayjsLocale';
import { loadDayjsLocaleModule, normalizeDayjsLocale } from '@/utils/dayjsLocale';

import { createShareI18n, type ShareResources } from './createShareI18n';

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

interface ShareLocaleProps extends PropsWithChildren {
  defaultLang?: string;
  resources?: ShareResources;
}

const ShareLocale = memo<ShareLocaleProps>(({ children, defaultLang, resources }) => {
  const [i18n] = useState(() => createShareI18n(defaultLang, resources));

  if (!i18n.instance.isInitialized) void i18n.init({ initAsync: !resources });

  useEffect(() => {
    void updateDayjs(i18n.instance.language || defaultLang || 'en-US');
    i18n.instance.on('languageChanged', updateDayjs);

    return () => {
      i18n.instance.off('languageChanged', updateDayjs);
    };
  }, [defaultLang, i18n]);

  return children;
});

ShareLocale.displayName = 'ShareLocale';

export default ShareLocale;
