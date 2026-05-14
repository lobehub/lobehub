import { existsSync, mkdirSync } from 'node:fs';

import { i18nConfig, localeDir } from './const';
import { genDefaultLocale } from './genDefaultLocale';
import { genDiff } from './genDiff';
import { split } from './utils';

// Ensure all locale directories exist
const ensureLocalesDirs = () => {
  [i18nConfig.entryLocale, ...i18nConfig.outputLocales].forEach((locale) => {
    const dir = localeDir(locale);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  });
};

// Run workflow
const run = async () => {
  // Ensure directories exist
  ensureLocalesDirs();

  // Diff analysis
  split('Diff Analysis');
  genDiff();

  // Generate default locale files
  split('Generate Default Locale Files');
  genDefaultLocale();

  // Generate i18n files
  split('Generate i18n Files');
};

run();
