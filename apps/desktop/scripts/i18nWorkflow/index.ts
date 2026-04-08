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
  split('差异分析');
  genDiff();

  // Generate default locale files
  split('生成默认语言文件');
  genDefaultLocale();

  // Generate i18n files
  split('生成国际化文件');
};

run();
