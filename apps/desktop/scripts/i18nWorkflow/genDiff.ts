import { consola } from 'consola';
import { colors } from 'consola/utils';
import { unset } from 'es-toolkit/compat';
import { diff } from 'just-diff';
import { existsSync } from 'node:fs';

import {
  entryLocaleJsonFilepath,
  i18nConfig,
  outputLocaleJsonFilepath,
  srcDefaultLocales,
} from './const';
import { readJSON, tagWhite, writeJSON } from './utils';

export const genDiff = () => {
  consola.start(`Comparing localization files between dev and prod environments...`);

  const resources = require(srcDefaultLocales);
  const data = Object.entries(resources.default);

  for (const [ns, devJSON] of data) {
    const filepath = entryLocaleJsonFilepath(`${ns}.json`);
    if (!existsSync(filepath)) {
      consola.info(`File does not exist, skipping: ${filepath}`);
      continue;
    }

    const prodJSON = readJSON(filepath);

    const diffResult = diff(prodJSON, devJSON as any);
    const remove = diffResult.filter((item) => item.op === 'remove');
    if (remove.length === 0) {
      consola.success(tagWhite(ns), colors.gray(filepath));
      continue;
    }

    const clearLocals: string[] = [];

    for (const locale of [i18nConfig.entryLocale, ...i18nConfig.outputLocales]) {
      const localeFilepath = outputLocaleJsonFilepath(locale, `${ns}.json`);
      if (!existsSync(localeFilepath)) continue;
      const localeJSON = readJSON(localeFilepath);

      for (const item of remove) {
        unset(localeJSON, item.path);
      }

      writeJSON(localeFilepath, localeJSON);
      clearLocals.push(locale);
    }

    if (clearLocals.length > 0) {
      consola.info('Cleaned up stale entries for the following locales:', clearLocals.join(', '));
    }
    consola.success(tagWhite(ns), colors.gray(filepath));
  }
};
