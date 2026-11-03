import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import i18nConfig from '../../.i18nrc';

export const root = resolve(__dirname, '../..');
export const localesDir = resolve(root, i18nConfig.output);
export const localeDir = (locale: string) => resolve(localesDir, locale);
export const localeDirJsonList = (locale: string) =>
  readdirSync(localeDir(locale)).filter((name) => name.includes('.json'));
export const srcLocalesDir = resolve(root, './src/main/locales');
export const entryLocaleJsonFilepath = (file: string) =>
  resolve(localesDir, i18nConfig.entryLocale, file);
export const outputLocaleJsonFilepath = (locale: string, file: string) =>
  resolve(localesDir, locale, file);
export const srcDefaultLocales = resolve(root, srcLocalesDir, 'default');

export { default as i18nConfig } from '../../.i18nrc';
