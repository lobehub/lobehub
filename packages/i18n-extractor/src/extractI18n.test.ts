import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Catalog, ExtractI18nConfig } from './extractI18n';
import { extractI18n } from './extractI18n';
import { createFixture, translatorType } from './testUtils';

const catalogs: Record<string, Record<string, Catalog>> = {
  'en-US': {
    home: { 'outer.key': 'Wrapper copy', 'shadowed.key': 'Shadowed copy', 'unused': 'Unused' },
    runtimeError: { Error: 'Default error', Other: 'Other error' },
  },
  'zh-CN': { runtimeError: { Error: '错误' } },
};

const setup = async () => {
  const root = await createFixture({
    'src/app/route.ts': 'export { copy } from "@/copy"; export { render } from "@/runtime";',
    'src/copy.ts': `${translatorType} declare const t: T<"home">; export const copy = () => t("outer.key");`,
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        noLib: true,
        paths: { '@/*': ['./src/*', './upstream/src/*'] },
        strict: true,
      },
    }),
    'upstream/src/copy.ts': `${translatorType} declare const t: T<"home">; export const copy = () => t("shadowed.key");`,
    'upstream/src/runtime.ts': `${translatorType} declare const t: T<"runtimeError">; export const render = (code: string) => t(code);`,
  });
  const config: ExtractI18nConfig = {
    catalog: {
      defaultLanguage: 'en-US',
      languages: () => ['zh-CN', 'ja-JP'],
      load: async (language, namespace) => catalogs[language]?.[namespace] ?? {},
    },
    dynamicKeys: [
      {
        file: 'upstream/src/runtime.ts',
        namespace: 'runtimeError',
        reason: 'Provider error codes arrive at runtime',
      },
    ],
    entries: ['src/app/route.ts'],
    root,
  };
  return { config, root };
};

describe('extractI18n', () => {
  it('projects reachable keys for every language and reports call sites', async () => {
    const { config } = await setup();
    const { report, resources } = await extractI18n(config);
    expect(resources).toEqual({
      'en-US': {
        home: { 'outer.key': 'Wrapper copy' },
        runtimeError: { Error: 'Default error', Other: 'Other error' },
      },
      'ja-JP': { home: {}, runtimeError: {} },
      'zh-CN': { home: {}, runtimeError: { Error: '错误' } },
    });
    expect(report.namespaces).toEqual({ home: 1, runtimeError: 2 });
    expect(report.files).toBe(3);
    expect(report.uses).toContainEqual(
      expect.objectContaining({ file: 'upstream/src/runtime.ts', patterns: ['.*'] }),
    );
    expect(report.imports).toContainEqual(
      expect.objectContaining({ from: 'src/app/route.ts', to: 'src/copy.ts' }),
    );
  });

  it('requires an allowlist entry with a reason for unbounded keys', async () => {
    const { config } = await setup();
    await expect(extractI18n({ ...config, dynamicKeys: [] })).rejects.toThrow(
      'unbounded dynamic translation key',
    );
    await expect(
      extractI18n({
        ...config,
        dynamicKeys: [{ file: 'upstream/src/runtime.ts', namespace: 'runtimeError', reason: ' ' }],
      }),
    ).rejects.toThrow('requires a reason');
  });

  it('rejects stale allowlist entries', async () => {
    const { config } = await setup();
    await expect(
      extractI18n({
        ...config,
        dynamicKeys: [{ file: 'src/missing.ts', namespace: 'home', reason: 'Stale registration' }],
      }),
    ).rejects.toThrow('ENOENT');
  });

  it('rejects required keys missing from the default catalog', async () => {
    const { config, root } = await setup();
    await writeFile(
      path.join(root, 'src/copy.ts'),
      `${translatorType} declare const t: T<"home">; export const copy = () => t("missing.key");`,
    );
    await expect(extractI18n(config)).rejects.toThrow('no en-US translation matches home:missing');
  });

  it('allows optional lookups of keys missing from the default catalog', async () => {
    const { config, root } = await setup();
    await writeFile(
      path.join(root, 'src/copy.ts'),
      'declare const find: ((key: string) => string | undefined) & { __i18nNamespace?: "home" }; export const copy = () => find("missing.key");',
    );
    const { resources } = await extractI18n(config);
    expect(resources['en-US'].home).toEqual({});
  });

  it('type-checks with the declaration files of the tsconfig', async () => {
    const { config, root } = await setup();
    await mkdir(path.join(root, 'src/types'));
    await writeFile(
      path.join(root, 'src/types/translator.d.ts'),
      `${translatorType} declare const homeT: T<"home">;`,
    );
    await writeFile(
      path.join(root, 'src/copy.ts'),
      'export const copy = () => homeT("outer.key");',
    );
    const { resources } = await extractI18n(config);
    expect(resources['en-US'].home).toEqual({ 'outer.key': 'Wrapper copy' });
  });

  it('type-checks with declarations outside the tsconfig', async () => {
    const { config, root } = await setup();
    await mkdir(path.join(root, 'typings'));
    await writeFile(
      path.join(root, 'typings/translator.d.ts'),
      `${translatorType} declare const homeT: T<"home">;`,
    );
    await writeFile(
      path.join(root, 'src/copy.ts'),
      'export const copy = () => homeT("outer.key");',
    );
    const tsconfig = path.join(root, 'tsconfig.json');
    const { compilerOptions } = JSON.parse(await readFile(tsconfig, 'utf8'));
    await writeFile(tsconfig, JSON.stringify({ compilerOptions, include: ['src', 'upstream'] }));
    expect((await extractI18n(config)).resources['en-US'].home).toBeUndefined();
    const { resources } = await extractI18n({
      ...config,
      declarations: ['typings/translator.d.ts'],
    });
    expect(resources['en-US'].home).toEqual({ 'outer.key': 'Wrapper copy' });
    await expect(
      extractI18n({ ...config, declarations: ['typings/missing.d.ts'] }),
    ).rejects.toThrow('ENOENT');
  });

  it('refuses to emit empty resources unless allowed', async () => {
    const { config, root } = await setup();
    await writeFile(path.join(root, 'src/app/route.ts'), 'export const value = 1;');
    await expect(extractI18n(config)).rejects.toThrow('No translation calls found');
    const { resources } = await extractI18n({ ...config, allowEmpty: true, dynamicKeys: [] });
    expect(resources).toEqual({ 'en-US': {}, 'ja-JP': {}, 'zh-CN': {} });
  });
});
