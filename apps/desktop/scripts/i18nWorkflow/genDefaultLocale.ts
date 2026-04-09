import { consola } from 'consola';
import { colors } from 'consola/utils';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { entryLocaleJsonFilepath, i18nConfig, localeDir, srcDefaultLocales } from './const';
import { tagWhite, writeJSON } from './utils';

export const genDefaultLocale = () => {
  consola.info(`默认语言为 ${i18nConfig.entryLocale}...`);

  // Ensure entry locale directory exists
  const entryLocaleDir = localeDir(i18nConfig.entryLocale);
  if (!existsSync(entryLocaleDir)) {
    mkdirSync(entryLocaleDir, { recursive: true });
    consola.info(`创建目录：${entryLocaleDir}`);
  }

  const resources = require(srcDefaultLocales);
  const data = Object.entries(resources.default);
  consola.start(`生成默认语言 JSON 文件，发现 ${data.length} 个命名空间...`);

  for (const [ns, value] of data) {
    const filepath = entryLocaleJsonFilepath(`${ns}.json`);

    // Ensure directory exists
    const dir = dirname(filepath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeJSON(filepath, value);
    consola.success(tagWhite(ns), colors.gray(filepath));
  }
};
