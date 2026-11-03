import { consola } from 'consola';
import { colors } from 'consola/utils';

import { entryLocaleJsonFilepath, i18nConfig, srcDefaultLocales } from './const';
import { tagWhite, writeJSONWithPrettier } from './utils';

export const genDefaultLocale = () => {
  consola.info(`Default locale is ${i18nConfig.entryLocale}...`);

  const resources = require(srcDefaultLocales);
  const data = Object.entries(resources.default);
  consola.start(`Generate default locale json, found ${data.length} namespaces...`);

  for (const [ns, value] of data) {
    const filepath = entryLocaleJsonFilepath(`${ns}.json`);
    writeJSONWithPrettier(filepath, value);
    consola.success(tagWhite(ns), colors.gray(filepath));
  }
};
