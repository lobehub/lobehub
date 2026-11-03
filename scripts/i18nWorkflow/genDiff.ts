import { existsSync } from 'node:fs';

import { consola } from 'consola';
import { colors } from 'consola/utils';
import { unset } from 'es-toolkit/compat';
import { diff } from 'just-diff';

import {
  entryLocaleJsonFilepath,
  i18nConfig,
  outputLocaleJsonFilepath,
  srcDefaultLocales,
} from './const';
import { readJSON, tagWhite, writeJSONWithPrettier } from './utils';

export const genDiff = () => {
  consola.start(`Remove diff analysis...`);

  const resources = require(srcDefaultLocales);
  const data = Object.entries(resources.default);

  for (const [ns, devJSON] of data) {
    const filepath = entryLocaleJsonFilepath(`${ns}.json`);
    if (!existsSync(filepath)) continue;
    const previousProdJSON = readJSON(filepath);

    const diffResult = diff(previousProdJSON, devJSON as any);
    if (diffResult.length === 0) {
      consola.success(tagWhite(ns), colors.gray(filepath));
      continue;
    }

    const clearLocals = [];

    for (const locale of i18nConfig.outputLocales) {
      const localeFilepath = outputLocaleJsonFilepath(locale, `${ns}.json`);
      if (!existsSync(localeFilepath)) continue;
      const localeJSON = readJSON(localeFilepath);

      for (const item of diffResult) {
        unset(localeJSON, item.path);
      }

      writeJSONWithPrettier(localeFilepath, localeJSON);
      clearLocals.push(locale);
    }
    consola.info('clear', clearLocals);
    consola.success(tagWhite(ns), colors.gray(filepath));
  }
};
