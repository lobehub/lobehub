import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { viteOsPlatformResolve } from '../../../../plugins/vite/osPlatformResolve';
import { collectSourceInputs, collectViteGraph } from '../mainHash.mjs';
import {
  diffInputs,
  validateInputManifest,
  validateReleaseInputs,
  validateRendererBase,
} from '../validateMainHash.mjs';

let root;
const put = async (file, content = '') => {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
};
const collect = (entry, resolve) =>
  collectViteGraph({
    configFile: false,
    root,
    resolve,
    build: { lib: { entry, formats: ['es'] }, ssr: true },
  });
const hash = async (options = {}) =>
  collectSourceInputs({
    repoRoot: root,
    publicKey: 'test-key',
    sourcePackages: [],
    graph:
      options.graph ??
      (await Promise.all(
        ['main', 'preload'].map((target) =>
          collect(path.join(options.repoRoot ?? root, `apps/desktop/src/${target}/index.ts`)),
        ),
      )),
    ...options,
  });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'main hash '));
  await put('apps/desktop/package.json', JSON.stringify({ version: '1.0.0' }));
  await put('apps/desktop/pnpm-lock.yaml', 'lockfileVersion: 9\n');
  await put('apps/desktop/pnpm-workspace.yaml', 'packages: []\n');
  await put('apps/desktop/tsconfig.json', '{}');
  for (const file of [
    'vite.main.config.ts',
    'vite.preload.config.ts',
    'vite.shared.ts',
    'native-deps.config.mjs',
    'external-runtime-deps.config.mjs',
    'module-deps.config.mjs',
    'scripts/mainHash.mjs',
    'scripts/mainHashGraph.mjs',
  ])
    await put(`apps/desktop/${file}`, 'export {};\n');
  for (const dir of ['main', 'preload', 'common'])
    await put(`apps/desktop/src/${dir}/index.ts`, 'export {};\n');
  await put('apps/desktop/src/main/index.ts', "export * from '../common/index';\n");
  await put('apps/desktop/resources/error.html', '<html>error</html>\n');
  await put('plugins/vite/platform.ts', 'export {};\n');
  await put('packages/native/binding.gyp', '{}');
  await put('packages/native/native/addon.mm', '// native v1\n');
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe('source main hash', () => {
  it.each([
    ['apps/desktop/src/main/index.ts', 'export const changed = true;'],
    ['apps/desktop/src/preload/index.ts', 'export const changed = true;'],
    ['apps/desktop/src/common/index.ts', 'export const changed = true;'],
    ['packages/native/native/addon.mm', '// native v2'],
    ['packages/native/binding.gyp', '{"targets":[]}'],
    ['apps/desktop/pnpm-lock.yaml', 'lockfileVersion: 9\npackages: {changed: true}\n'],
    ['apps/desktop/package.json', '{"version":"1.0.1"}'],
    ['apps/desktop/vite.shared.ts', 'export const target = "node24";'],
    ['apps/desktop/resources/error.html', '<html>new error</html>'],
  ])('invalidates all platforms for %s', async (file, content) => {
    const before = await hash();
    await put(file, content);
    const after = await hash();
    expect(after.mainHash).not.toBe(before.mainHash);
    expect(diffInputs(before, after).some((line) => line.includes(`oss/${file}:`))).toBe(true);
    expect(() => validateInputManifest(after)).not.toThrow();
  });

  it('ignores installed native variants, generated output, renderer, docs and tests', async () => {
    const before = await hash();
    for (const file of [
      'apps/desktop/node_modules/native-darwin/package.json',
      'apps/desktop/node_modules/native-linux/package.json',
      'apps/desktop/dist/main/index.js',
      'apps/desktop/src/overlay/entry.tsx',
      'apps/desktop/src/main/__tests__/foo.test.ts',
      'apps/desktop/src/main/README.md',
      'apps/desktop/resources/bin/lobe-cli.js',
      'apps/desktop/resources/cli-package.json',
      'packages/native/build/Release/addon.node',
      'packages/native/dist/index.js',
    ])
      await put(file, '{}');
    expect((await hash()).mainHash).toBe(before.mainHash);
  });

  it('normalizes text line endings, but preserves JSON key order and binary resource bytes', async () => {
    await put('apps/desktop/package.json', '{"version":"1.0.0","name":"desktop"}\n');
    const before = await hash();
    await put('apps/desktop/package.json', '{"version":"1.0.0","name":"desktop"}\r\n');
    await put('apps/desktop/src/main/index.ts', "export * from '../common/index';\r\n");
    expect((await hash()).mainHash).toBe(before.mainHash);
    await put('apps/desktop/package.json', '{"name":"desktop","version":"1.0.0"}\n');
    expect((await hash()).mainHash).not.toBe(before.mainHash);
    await put('apps/desktop/resources/icon.png', Buffer.from([0, 13, 10, 255]));
    const withBinary = await hash();
    await put('apps/desktop/resources/icon.png', Buffer.from([0, 10, 255]));
    expect((await hash()).mainHash).not.toBe(withBinary.mainHash);
  });

  it('is independent of checkout location and symlinked roots', async () => {
    const copy = `${root}-copy`;
    const link = `${root}-link`;
    try {
      await cp(root, copy, { recursive: true });
      await symlink(copy, link, process.platform === 'win32' ? 'junction' : 'dir');
      expect((await hash({ repoRoot: copy })).mainHash).toBe((await hash()).mainHash);
      expect((await hash({ repoRoot: link })).mainHash).toBe((await hash()).mainHash);
    } finally {
      await rm(link, { force: true });
      await rm(copy, { recursive: true, force: true });
    }
  });

  it('canonicalizes graph paths before walking package boundaries', async () => {
    await put('package.json', '{"private":true}');
    const node = (id) => ({
      configFiles: [],
      defines: {},
      nodes: new Map([
        [
          id,
          {
            ast: undefined,
            dynamicImports: [],
            entry: false,
            external: false,
            id,
            imports: [],
            retained: false,
          },
        ],
      ]),
    });
    const canonical = await hash({ graph: [node(path.join(root, 'package.json'))] });
    const relative = `${root}/apps/desktop/src/main/../../../../package.json`;

    expect((await hash({ graph: [node(relative)] })).mainHash).toBe(canonical.mainHash);
  });

  it('tracks Cloud runtime sources and dependency declarations without the whole Cloud revision', async () => {
    const cloud = `${root}-cloud`;
    try {
      await mkdir(path.join(cloud, 'scripts/cloud-desktop'), { recursive: true });
      await writeFile(path.join(cloud, 'package.json'), '{"dependencies":{"sentry":"1.0.0"}}');
      const source = path.join(cloud, 'runtime.ts');
      await writeFile(source, 'export const value = 1;');
      const cloudHash = async () => hash({ cloudRoot: cloud, graph: [await collect(source)] });
      const before = await cloudHash();
      await writeFile(path.join(cloud, 'renderer.ts'), 'renderer-only change');
      expect((await cloudHash()).mainHash).toBe(before.mainHash);
      await writeFile(source, 'export const value = 2;');
      const changed = await cloudHash();
      expect(changed.mainHash).not.toBe(before.mainHash);
      await writeFile(path.join(cloud, 'package.json'), '{"dependencies":{"sentry":"2.0.0"}}');
      expect((await cloudHash()).mainHash).not.toBe(changed.mainHash);
    } finally {
      await rm(cloud, { force: true, recursive: true });
    }
  });

  it('does not hide deleted sources, missing locks or changed keys', async () => {
    const before = await hash();
    expect((await hash({ publicKey: 'another-key' })).mainHash).not.toBe(before.mainHash);
    await rm(path.join(root, 'packages/native/native/addon.mm'));
    expect((await hash()).mainHash).not.toBe(before.mainHash);
    await rm(path.join(root, 'apps/desktop/pnpm-lock.yaml'));
    await expect(hash()).rejects.toThrow();
  });
});

describe('workspace Vite graph', () => {
  const collect = async () =>
    collectViteGraph({
      configFile: false,
      root,
      build: {
        lib: { entry: path.join(root, 'apps/desktop/src/main/index.ts'), formats: ['es'] },
        ssr: true,
      },
      resolve: { alias: { '@workspace': path.join(root, 'packages/shared/src') } },
    });

  it('follows runtime, side-effect and dynamic imports but not type-only or unused files', async () => {
    await put('packages/shared/src/runtime.ts', 'export const value = 1;');
    await put('packages/shared/src/types.ts', 'export interface Value { value: number }');
    await put('packages/shared/src/unused.ts', 'export const unused = 1;');
    await put('packages/shared/src/effect.ts', 'globalThis.effect = true;');
    await put('packages/shared/src/lazy.ts', 'export const lazy = 1;');
    await put('packages/shared/src/data.json', '{"label":"v1"}');
    await put(
      'apps/desktop/src/main/index.ts',
      `
      import type { Value } from '@workspace/types';
      import { value } from '@workspace/runtime';
      import '@workspace/effect';
      import data from '@workspace/data.json';
      export const result: Value = { value };
      export const label = data.label;
      export const load = () => import('@workspace/lazy');
    `,
    );
    await put('packages/shared/package.json', '{"type":"module"}');
    const graph = await collect();
    const before = await hash({ graph: [graph] });
    const paths = [
      ...before.inputs.map((input) => input.path.replace(/^\$graph\/main\//, '')),
      ...before.graph.flatMap((target) => target.modules.flatMap((node) => node.inlined)),
    ];
    expect(paths).toContain('oss/packages/shared/src/runtime.ts');
    expect(paths).toContain('oss/packages/shared/src/effect.ts');
    expect(paths).toContain('oss/packages/shared/src/lazy.ts');
    expect(paths).toContain('oss/packages/shared/src/data.json');
    expect(paths).not.toContain('oss/packages/shared/src/types.ts');
    expect(paths).not.toContain('oss/packages/shared/src/unused.ts');
    await put('packages/shared/src/types.ts', 'export interface Value { other: string }');
    await put('packages/shared/src/unused.ts', 'export const unused = 2;');
    expect((await hash({ graph: [await collect()] })).mainHash).toBe(before.mainHash);
    await put('packages/shared/package.json', '{"type":"module","sideEffects":false}');
    expect((await hash({ graph: [await collect()] })).mainHash).not.toBe(before.mainHash);
    await put('packages/shared/package.json', '{"type":"module"}');
    await put('packages/shared/src/runtime.ts', 'export const value = 2;');
    expect((await hash({ graph: [await collect()] })).mainHash).not.toBe(before.mainHash);
  });

  it('ignores types, comments and unused forwarding exports, but detects a live binding swap', async () => {
    await put('apps/desktop/src/main/a.ts', 'export const a = 11;');
    await put('apps/desktop/src/main/b.ts', 'export const b = 22;');
    await put('apps/desktop/src/main/forward.ts', "export { a } from './a';");
    await put('apps/desktop/src/main/types.ts', 'export interface Value { name: string }');
    const barrel = 'apps/desktop/src/main/barrel.ts';
    await put(barrel, "export { a as selected } from './a';");
    await put(
      'apps/desktop/src/main/index.ts',
      `
      import { selected } from './barrel';
      import { a } from './a';
      import { b } from './b';
      export const result = [selected, a, b];
    `,
    );
    const capture = async () => {
      let code;
      const graph = await collectViteGraph({
        configFile: false,
        root,
        build: {
          lib: { entry: path.join(root, 'apps/desktop/src/main/index.ts'), formats: ['es'] },
        },
        plugins: [
          {
            name: 'capture-result',
            generateBundle(_options, bundle) {
              code = Object.values(bundle).find((item) => item.type === 'chunk').code;
            },
          },
        ],
      });
      const output = await import(
        `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
      );
      return { manifest: await hash({ graph: [graph] }), result: output.result };
    };
    const before = await capture();
    expect(before.result).toEqual([11, 11, 22]);
    for (const source of [
      "// another comment\nexport { a as selected } from './a'; export type { Value } from './types';",
      "export { a as selected } from './a'; export * from './types';",
      "export { a as selected } from './a'; export { b as unused } from './b';",
      "export { a as selected } from './forward';",
    ]) {
      await put(barrel, source);
      const after = await capture();
      expect(after.result).toEqual(before.result);
      expect(after.manifest.mainHash).toBe(before.manifest.mainHash);
    }
    await put(barrel, "export { b as selected } from './b';");
    const swapped = await capture();
    expect(swapped.result).toEqual([22, 11, 22]);
    expect(swapped.manifest.mainHash).not.toBe(before.manifest.mainHash);
  });

  it.each([
    [
      "import { selected } from './barrel'; export const result = selected;",
      "export { a as selected } from './a';",
      "export { b as selected } from './b';",
    ],
    [
      "import selected from './barrel'; export const result = selected;",
      "export { a as default } from './a';",
      "export { b as default } from './b';",
    ],
    [
      "import * as value from './barrel'; export const result = value.selected;",
      "export { a as selected } from './a';",
      "export { b as selected } from './b';",
    ],
    [
      "export const load = () => import('./barrel');",
      "export { a as selected } from './a';",
      "export { b as selected } from './b';",
    ],
  ])(
    'tracks named, default, namespace and dynamic bindings: %s',
    async (entry, beforeSource, afterSource) => {
      await put('apps/desktop/src/main/a.ts', 'export const a = 11;');
      await put('apps/desktop/src/main/b.ts', 'export const b = 22;');
      await put(
        'apps/desktop/src/main/index.ts',
        `${entry}\nexport { a } from './a'; export { b } from './b';`,
      );
      await put('apps/desktop/src/main/barrel.ts', beforeSource);
      const before = await hash();
      await put('apps/desktop/src/main/barrel.ts', afterSource);
      expect((await hash()).mainHash).not.toBe(before.mainHash);
    },
  );

  it('preserves side-effect order through omitted forwarding modules', async () => {
    await put('apps/desktop/src/main/a.ts', 'globalThis.order = "a";');
    await put('apps/desktop/src/main/b.ts', 'globalThis.order += "b";');
    await put(
      'apps/desktop/src/main/index.ts',
      "import './barrel'; export const result = globalThis.order;",
    );
    await put('apps/desktop/src/main/barrel.ts', "import './a'; import './b';");
    const before = await hash();
    await put('apps/desktop/src/main/barrel.ts', "import './b'; import './a';");
    expect((await hash()).mainHash).not.toBe(before.mainHash);
  });

  it('ignores ordinary comments while preserving tree-shaking annotations', async () => {
    await put('apps/desktop/src/main/index.ts', 'export const result = 1; globalThis.effect();');
    const before = await hash();
    await put(
      'apps/desktop/src/main/index.ts',
      '// comment\nexport const result = 1; /* another */ globalThis.effect();',
    );
    expect((await hash()).mainHash).toBe(before.mainHash);
    await put(
      'apps/desktop/src/main/index.ts',
      'export const result = 1; /* @__PURE__ */ globalThis.effect();',
    );
    expect((await hash()).mainHash).not.toBe(before.mainHash);
  });

  it('keeps transitive definitions used by constant folding', async () => {
    await put('apps/desktop/src/main/a.ts', 'export const a = 11;');
    await put('apps/desktop/src/main/barrel.ts', "export { a } from './a';");
    await put(
      'apps/desktop/src/main/b.ts',
      "import { a } from './barrel'; export const b = a + 1;",
    );
    await put(
      'apps/desktop/src/main/index.ts',
      "import { b } from './b'; export const result = b + 1;",
    );
    const before = await hash();
    await put('apps/desktop/src/main/a.ts', 'export const a = 22;');
    expect((await hash()).mainHash).not.toBe(before.mainHash);
  });

  it('ignores unread namespace exports, but includes the namespace receiver of method calls', async () => {
    await put(
      'apps/desktop/src/main/a.ts',
      'export const a = 11; export function read() { return this.spare; }',
    );
    await put('apps/desktop/src/main/b.ts', 'export const b = 22;');
    const barrel = 'apps/desktop/src/main/barrel.ts';
    const entry = 'apps/desktop/src/main/index.ts';
    await put(barrel, "export { a as selected, a as spare, read } from './a';");
    await put(
      entry,
      "import * as ns from './barrel'; export const result = ns.selected; export { a } from './a'; export { b } from './b';",
    );
    const before = await hash();
    await put(
      barrel,
      "export { a as selected, read } from './a'; export { b as spare } from './b';",
    );
    expect((await hash()).mainHash).toBe(before.mainHash);
    await put(
      entry,
      "import * as ns from './barrel'; export const result = ns.read(); export { a } from './a'; export { b } from './b';",
    );
    const call = await hash();
    await put(barrel, "export { a as selected, a as spare, read } from './a';");
    expect((await hash()).mainHash).not.toBe(call.mainHash);
  });

  it('requires bundled npm code to be pinned by the Desktop lockfile', async () => {
    await mkdir(path.join(root, 'apps/desktop/node_modules'), { recursive: true });
    await put(
      'node_modules/floating/package.json',
      '{"name":"floating","version":"1.0.0","type":"module","main":"index.js"}',
    );
    await put('node_modules/floating/index.js', 'export const value = 1;');
    await put(
      'apps/desktop/src/main/index.ts',
      "import { value } from 'floating'; export const result = value;",
    );
    const graph = await collectViteGraph({
      configFile: false,
      root,
      build: {
        lib: { entry: path.join(root, 'apps/desktop/src/main/index.ts'), formats: ['es'] },
        ssr: true,
      },
      ssr: { noExternal: true },
    });
    await expect(hash({ graph: [graph] })).rejects.toThrow(
      'not pinned by apps/desktop/pnpm-lock.yaml: floating@1.0.0',
    );
    await put('apps/desktop/pnpm-lock.yaml', 'lockfileVersion: 9\npackages:\n  floating@1.0.0:\n');
    expect((await hash({ graph: [graph] })).mainHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tracks star forwarding, cycles and CommonJS without dropping runtime dependencies', async () => {
    await put('apps/desktop/src/main/a.ts', 'export const selected = 11;');
    await put('apps/desktop/src/main/b.ts', 'export const selected = 22;');
    await put('apps/desktop/src/main/barrel.ts', "export * from './forward';");
    await put('apps/desktop/src/main/forward.ts', "export * from './barrel'; export * from './a';");
    await put(
      'apps/desktop/src/main/index.ts',
      "export { selected } from './barrel'; export { selected as a } from './a'; export { selected as b } from './b';",
    );
    const before = await hash();
    await put('apps/desktop/src/main/forward.ts', "export * from './barrel'; export * from './b';");
    expect((await hash()).mainHash).not.toBe(before.mainHash);
    await put('apps/desktop/src/main/legacy.cjs', 'module.exports = { value: 11 };');
    await put(
      'apps/desktop/src/main/index.ts',
      "import value from './legacy.cjs'; export const result = value.value;",
    );
    const legacy = await hash();
    await put('apps/desktop/src/main/legacy.cjs', 'module.exports = { value: 22 };');
    expect((await hash()).mainHash).not.toBe(legacy.mainHash);
  });

  it('covers unselected platform branches and keeps shared descendants in the runtime graph', async () => {
    await put(
      'apps/desktop/src/main/index.ts',
      "export { platform } from './platform'; export { shared } from './shared';",
    );
    await put('apps/desktop/src/main/platform.ts', "export const platform = 'default';");
    await put(
      'apps/desktop/src/main/platform.mac.ts',
      "import { shared } from './shared'; import { mac } from './mac-only'; export const platform = shared + mac;",
    );
    await put('apps/desktop/src/main/shared.ts', 'export const shared = 1;');
    await put('apps/desktop/src/main/mac-only.ts', 'export const mac = 2;');
    const platformHash = async () => {
      const graph = [];
      for (const os of ['mac', 'linux', 'windows']) {
        graph.push({
          ...(await collectViteGraph({
            configFile: false,
            root,
            build: {
              lib: { entry: path.join(root, 'apps/desktop/src/main/index.ts'), formats: ['es'] },
            },
            plugins: [viteOsPlatformResolve(os)],
          })),
          label: `main/${os}`,
        });
      }
      return hash({ graph });
    };
    const before = await platformHash();
    expect(
      before.inputs.some((item) => item.path.endsWith('/mac-only.ts') && item.group === 'platform'),
    ).toBe(true);
    await put('apps/desktop/src/main/mac-only.ts', 'export const mac = 3;');
    const platformChange = await platformHash();
    expect(platformChange.mainHash).not.toBe(before.mainHash);
    await put('apps/desktop/src/main/shared.ts', 'export const shared = 4;');
    expect((await platformHash()).mainHash).not.toBe(platformChange.mainHash);
  });
});

describe('release hash validation', () => {
  it('validates release manifests without installing Vite in the publishing job', async () => {
    const directory = path.join(root, 'validator');
    await mkdir(directory);
    for (const file of ['mainHash.mjs', 'mainHashGraph.mjs', 'validateMainHash.mjs']) {
      await cp(new URL(`../${file}`, import.meta.url), path.join(directory, file));
    }
    const manifest = await hash();
    const module = pathToFileURL(path.join(directory, 'validateMainHash.mjs')).href;
    await expect(
      promisify(execFile)(process.execPath, [
        '--input-type=module',
        '-e',
        `import { validateInputManifest } from ${JSON.stringify(module)}; validateInputManifest(${JSON.stringify(manifest)});`,
      ]),
    ).resolves.toMatchObject({ stdout: '', stderr: '' });
  });

  it('requires r0, the source manifest and the packaged hash to agree', async () => {
    const inputs = await hash();
    const release = path.join(root, 'release');
    await put('release/renderer-mainhash-inputs.json', JSON.stringify(inputs));
    await put('release/renderer-mainhash.txt', inputs.mainHash);
    const feed = 'release/renderer-ota/canary/1.0.0/renderer/v2';
    const pack = `packs/${'a'.repeat(64)}.zip`;
    const r0 = {
      appVersion: '1.0.0',
      version: 'r0',
      schemaVersion: 2,
      mainHash: inputs.mainHash,
      full: { path: pack },
    };
    await put(`${feed}/latest.json`, JSON.stringify(r0));
    await put(`${feed}/versions/r0.json`, JSON.stringify(r0));
    await put(`${feed}/${pack}`, 'pack');
    await expect(validateRendererBase(release, 'canary', '1.0.0')).resolves.toMatchObject({
      mainHash: inputs.mainHash,
    });
    await put(`${feed}/latest.json`, JSON.stringify({ ...r0, mainHash: 'b'.repeat(64) }));
    await expect(validateRendererBase(release, 'canary', '1.0.0')).rejects.toThrow(
      'does not match',
    );
    await put(`${feed}/latest.json`, JSON.stringify(r0));
    await rm(path.join(root, feed, pack));
    await expect(validateRendererBase(release, 'canary', '1.0.0')).rejects.toThrow();
  });

  it('blocks missing platforms and changed contents before writing a canonical base', async () => {
    const before = await hash();
    const release = path.join(root, 'release');
    await put('release/renderer-mainhash/mac.json', JSON.stringify(before));
    await expect(validateReleaseInputs(release, ['mac', 'linux'])).rejects.toThrow('expected');
    await put('apps/desktop/src/main/index.ts', 'export const changed = true;');
    const after = await hash();
    await put('release/renderer-mainhash/linux.json', JSON.stringify(after));
    await expect(validateReleaseInputs(release, ['mac', 'linux'])).rejects.toThrow(
      'oss/apps/desktop/src/main/index.ts',
    );
    await expect(readFile(path.join(release, 'renderer-mainhash.txt'))).rejects.toThrow();
    await put('release/renderer-mainhash/linux.json', JSON.stringify(before));
    await validateReleaseInputs(release, ['mac', 'linux']);
    expect((await readFile(path.join(release, 'renderer-mainhash.txt'), 'utf8')).trim()).toBe(
      before.mainHash,
    );
    expect(() => validateInputManifest({ ...before, mainHash: after.mainHash })).toThrow(
      'does not match',
    );
    expect(() => validateInputManifest({ ...before, algorithm: 'old-bundle' })).toThrow(
      'full release required',
    );
  });
});
