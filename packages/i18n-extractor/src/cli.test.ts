import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { expect, it, vi } from 'vitest';

import { runCli } from './cli';
import { createFixture, translatorType } from './testUtils';

it('writes the resources module and report only when they change', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const root = await createFixture({
    'i18n.config.mjs': `export default () => ({
  catalog: {
    defaultLanguage: 'en',
    languages: ['de'],
    load: (language, namespace) => ({ en: { title: 'Title', other: 'Other' }, de: { title: 'Titel' } })[language],
  },
  entries: ['entry.ts'],
  output: 'generated/resources.js',
  report: 'generated/report.json',
});
`,
    'entry.ts': `${translatorType} declare const t: T<"app">; t("title");`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { noLib: true, strict: true } }),
  });
  const config = path.join(root, 'i18n.config.mjs');
  const report = await runCli(['--config', config]);
  expect(report.namespaces).toEqual({ app: 1 });
  const output = path.join(root, 'generated/resources.js');
  expect(await readFile(output, 'utf8')).toContain(
    'export const resources = {"de":{"app":{"title":"Titel"}},"en":{"app":{"title":"Title"}}};',
  );
  expect(JSON.parse(await readFile(path.join(root, 'generated/report.json'), 'utf8'))).toEqual(
    expect.objectContaining({ bytes: report.bytes, files: 1 }),
  );
  const { mtimeMs } = await stat(output);
  await runCli(['-c', config]);
  expect((await stat(output)).mtimeMs).toBe(mtimeMs);
});

it('requires a config path', async () => {
  await expect(runCli([])).rejects.toThrow('Usage: i18n-extract --config <path>');
});
