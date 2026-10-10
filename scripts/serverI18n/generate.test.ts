import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { generateServerI18n } from './generate';

it('extracts wrapped server error codes using the source repository allowlist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'server-i18n-wrapper-'));
  const sourceRoot = path.join(root, 'upstream');
  try {
    const files = {
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
          noLib: true,
          paths: { '@/*': ['./src/*', './upstream/src/*'] },
        },
      }),
      'src/app/route.ts': 'export { copy } from "@/copy";',
      'src/copy.ts':
        'declare const t: ((key: string) => string) & { __serverNamespace?: "home" }; export const copy = () => t("outer.key");',
      'upstream/src/copy.ts':
        'declare const t: ((key: string) => string) & { __serverNamespace?: "home" }; export const copy = () => t("shadowed.key");',
      'upstream/apps/server/src/router-hono/standalone.ts':
        'export { render } from "../services/taskLifecycle";',
      'upstream/apps/server/src/services/taskLifecycle/index.ts':
        'declare const t: ((key: string) => string) & { __serverNamespace?: "runtimeError" }; export const render = (code: string) => t(code);',
      'upstream/packages/locales/src/default/runtimeError.ts':
        'export default { Error: "Default error" };',
      'upstream/packages/locales/src/default/home.ts':
        'export default { "outer.key": "Wrapper copy", "shadowed.key": "Shadowed copy" };',
      'upstream/locales/en-US/runtimeError.json': '{}',
      'upstream/locales/zh-CN/runtimeError.json': JSON.stringify({ Error: '错误' }),
    };
    await mkdir(path.join(root, 'packages'), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    const report = await generateServerI18n(root, sourceRoot);
    expect(report.namespaces).toEqual({ home: 1, runtimeError: 1 });
    const resources = await readFile(
      path.join(sourceRoot, 'src/libs/i18n/server/generated/resources.js'),
      'utf8',
    );
    expect(resources).toContain('Default error');
    expect(resources).toContain('错误');
    expect(resources).toContain('Wrapper copy');
    expect(resources).not.toContain('Shadowed copy');
    expect(report.uses).toContainEqual(
      expect.objectContaining({
        file: 'upstream/apps/server/src/services/taskLifecycle/index.ts',
        patterns: ['.*'],
      }),
    );

    await writeFile(
      path.join(root, 'src/copy.ts'),
      'declare const t: ((key: string) => string) & { __serverNamespace?: "home" }; export const copy = (key: string) => t(key);',
    );
    await expect(generateServerI18n(root, sourceRoot)).rejects.toThrow(
      'unbounded dynamic translation key',
    );
    await writeFile(
      path.join(root, 'server-i18n.config.json'),
      JSON.stringify({
        dynamicKeys: [{ file: 'src/copy.ts', namespace: 'home', reason: 'External key domain' }],
      }),
    );
    expect((await generateServerI18n(root, sourceRoot)).namespaces.home).toBe(2);
    await writeFile(
      path.join(root, 'server-i18n.config.json'),
      JSON.stringify({
        dynamicKeys: [{ file: 'src/missing.ts', namespace: 'home', reason: 'Stale registration' }],
      }),
    );
    await expect(generateServerI18n(root, sourceRoot)).rejects.toThrow('ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
