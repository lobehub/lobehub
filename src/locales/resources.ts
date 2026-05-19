import { DEFAULT_LANG } from '@/const/locale';

import type resources from './default';

export const locales = [
  'en-US',
  'te-IN',
  'ti-IN',
] as const;

export type DefaultResources = typeof resources;
export type NS = keyof DefaultResources;
export type Locales = (typeof locales)[number];

export const normalizeLocale = (locale?: string): Locales => {
  if (!locale) return DEFAULT_LANG;

  if (locale.startsWith('te')) return 'te-IN';
  if (locale.startsWith('ti')) return 'ti-IN';

  for (const l of locales) {
    if (l.startsWith(locale)) {
      return l;
    }
  }

  return DEFAULT_LANG;
};

type LocaleOptions = {
  label: string;
  value: Locales;
}[];

export const localeOptions: LocaleOptions = [
  {
    label: 'English',
    value: 'en-US',
  },
  {
    label: 'తెలుగు',
    value: 'te-IN',
  },
  {
    label: 'Tinglish (Telugu+English)',
    value: 'ti-IN',
  },
] as LocaleOptions;

export const supportLocales: string[] = [...locales, 'en'];
