import { consola } from 'consola';
import { colors } from 'consola/utils';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import i18nConfig from '../../.i18nrc';

export const readJSON = (filePath: string) => {
  const data = readFileSync(filePath, 'utf8');
  return JSON.parse(data);
};

export const writeJSON = (filePath: string, data: any) => {
  const jsonStr = JSON.stringify(data, null, 2);
  writeFileSync(filePath, jsonStr, 'utf8');
};

export const genResourcesContent = (locales: string[]) => {
  let index = '';
  let indexObj = '';

  for (const locale of locales) {
    index += `import ${locale} from "./${locale}";\n`;
    indexObj += `   "${locale.replace('_', '-')}": ${locale},\n`;
  }

  return `${index}
const resources = {
${indexObj}} as const;
export default resources;
export const defaultResources = ${i18nConfig.entryLocale};
export type Resources = typeof resources;
export type DefaultResources = typeof defaultResources;
export type Namespaces = keyof DefaultResources;
export type Locales = keyof Resources;
`;
};

export const genNamespaceList = (files: string[], locale: string) => {
  return files.map((file) => ({
    name: file.replace('.json', ''),
    path: resolve(i18nConfig.output, locale, file),
  }));
};

export const tagBlue = (text: string) => colors.bgBlueBright(colors.black(` ${text} `));
export const tagYellow = (text: string) => colors.bgYellowBright(colors.black(` ${text} `));
export const tagGreen = (text: string) => colors.bgGreenBright(colors.black(` ${text} `));
export const tagWhite = (text: string) => colors.bgWhiteBright(colors.black(` ${text} `));

export const split = (name: string) => {
  consola.log('');
  consola.log(colors.gray(`========================== ${name} ==============================`));
};
