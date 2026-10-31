import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import type { ExtractI18nConfig, I18nReport } from './extractI18n';
import { extractI18n } from './extractI18n';
import { renderResourcesModule, writeIfChanged } from './output';

export interface I18nExtractCliConfig extends Omit<ExtractI18nConfig, 'root'> {
  exportName?: string;
  output: string;
  report?: string;
  root?: string;
}

type ConfigExport =
  I18nExtractCliConfig | (() => I18nExtractCliConfig | Promise<I18nExtractCliConfig>);

export const defineConfig = <T extends ConfigExport>(config: T) => config;

const USAGE = 'Usage: i18n-extract --config <path>';

export const runCli = async (argv: string[]): Promise<I18nReport & { bytes: number }> => {
  const { values } = parseArgs({
    args: argv,
    options: { config: { short: 'c', type: 'string' } },
    strict: true,
  });
  if (!values.config) throw new Error(USAGE);
  const configPath = path.resolve(values.config);
  const exported = ((await import(pathToFileURL(configPath).href)) as { default?: ConfigExport })
    .default;
  if (!exported) throw new Error(`${configPath} has no default export`);
  const config = typeof exported === 'function' ? await exported() : exported;
  const root = path.resolve(path.dirname(configPath), config.root ?? '.');
  const { report, resources } = await extractI18n({ ...config, root });
  const output = renderResourcesModule(resources, config.exportName);
  await writeIfChanged(path.resolve(root, config.output), output);
  const result = { bytes: Buffer.byteLength(output), ...report };
  if (config.report)
    await writeIfChanged(path.resolve(root, config.report), `${JSON.stringify(result, null, 2)}\n`);
  console.info(
    'i18n-extract:',
    JSON.stringify({ bytes: result.bytes, files: result.files, namespaces: result.namespaces }),
  );
  return result;
};
