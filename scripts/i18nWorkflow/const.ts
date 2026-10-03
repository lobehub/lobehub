import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import i18nConfig, { root } from './i18nConfig';

export const localesDir = resolve(root, i18nConfig.output);
export const localeDir = (locale: string) => resolve(localesDir, locale);
export const localeDirJsonList = (locale: string) =>
  readdirSync(localeDir(locale)).filter((name) => name.includes('.json'));
export const entryLocaleJsonFilepath = (file: string) =>
  resolve(localesDir, i18nConfig.entryLocale, file);
export const outputLocaleJsonFilepath = (locale: string, file: string) =>
  resolve(localesDir, locale, file);
export const srcDefaultLocales = resolve(root, i18nConfig.sourceDir);

export { i18nConfig };
