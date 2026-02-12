import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import prettier from '@prettier/sync';
import { consola } from 'consola';
import { colors } from 'consola/utils';

import { toLodashPath } from '../../src/locales/utils';
import { localeDir, localeDirJsonList, localesDir, srcDefaultLocales } from './const';

const prettierOptions = prettier.resolveConfig(resolve(__dirname, '../../.prettierrc.js')) ?? {};

const DEFAULT_SKIP_FILES = new Set(['index.ts', 'models.ts', 'providers.ts']);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;
  return Object.prototype.toString.call(value) === '[object Object]';
};

const shouldPreserveObject = (value: Record<string, unknown>) => {
  const keys = Object.keys(value);
  if (keys.length === 0) return true;
  return keys.every((key) => /^\d+$/.test(key));
};

const flattenObject = (input: Record<string, unknown>) => {
  const output: Record<string, unknown> = {};

  const addEntry = (pathSegments: Array<number | string>, value: unknown) => {
    const key = toLodashPath(pathSegments);
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      throw new Error(`Duplicate i18n key detected: ${key}`);
    }
    output[key] = value;
  };

  const visit = (value: unknown, pathSegments: Array<number | string>) => {
    if (Array.isArray(value)) {
      addEntry(pathSegments, value);
      return;
    }

    if (isPlainObject(value)) {
      if (shouldPreserveObject(value)) {
        addEntry(pathSegments, value);
        return;
      }

      const entries = Object.entries(value);
      if (entries.length === 0) {
        addEntry(pathSegments, value);
        return;
      }

      for (const [childKey, childValue] of entries) {
        visit(childValue, [...pathSegments, childKey]);
      }
      return;
    }

    addEntry(pathSegments, value);
  };

  for (const [key, value] of Object.entries(input)) {
    visit(value, [key]);
  }

  return output;
};

const writeTs = (filePath: string, data: Record<string, unknown>) => {
  const content = `export default ${JSON.stringify(data, null, 2)};\n`;
  const formatted = prettier.format(content, {
    ...prettierOptions,
    parser: 'typescript',
  });
  writeFileSync(filePath, formatted, 'utf8');
};

const writeJson = (filePath: string, data: Record<string, unknown>) => {
  const json = JSON.stringify(data, null, 2);
  const formatted = prettier.format(json, {
    ...prettierOptions,
    parser: 'json',
  });
  writeFileSync(filePath, formatted, 'utf8');
};

const flattenDefaultLocales = async () => {
  const files = readdirSync(srcDefaultLocales).filter((file) => file.endsWith('.ts'));

  for (const file of files) {
    if (DEFAULT_SKIP_FILES.has(file)) continue;

    const filePath = resolve(srcDefaultLocales, file);
    const fileUrl = pathToFileURL(filePath).href;
    const loaded = await import(fileUrl);
    const data = loaded.default ?? loaded;

    const flat = flattenObject(data as Record<string, unknown>);
    writeTs(filePath, flat);
    consola.success(colors.cyan(file), colors.gray('flattened'));
  }
};

const flattenLocaleJsons = () => {
  const localeFolders = readdirSync(localesDir).filter((dir) =>
    statSync(localeDir(dir)).isDirectory(),
  );

  for (const locale of localeFolders) {
    const jsonFiles = localeDirJsonList(locale);
    for (const jsonFile of jsonFiles) {
      const filePath = resolve(localeDir(locale), jsonFile);
      const raw = readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      const flat = flattenObject(data);
      writeJson(filePath, flat);
      consola.success(colors.cyan(`${locale}/${jsonFile}`), colors.gray('flattened'));
    }
  }
};

const run = async () => {
  consola.start('Flattening src/locales/default...');
  await flattenDefaultLocales();

  consola.start('Flattening locales JSON files...');
  flattenLocaleJsons();

  consola.success('Flattening completed.');
};

run().catch((error) => {
  consola.error(error);

  process.exit(1);
});
