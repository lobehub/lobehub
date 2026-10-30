// @vitest-environment node
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CanvasRuntimeManifest } from '@lobechat/canvas/runtime';
import { build, createServer } from 'vite';
import { expect, it } from 'vitest';

import { canvasRuntime } from './canvasRuntime';

it('reuses App dependencies for injected runtime and excludes the publication bundle', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'canvas-chunks-'));
  try {
    await mkdir(path.join(root, 'public/canvas-runtime/v1'), { recursive: true });
    await writeFile(path.join(root, 'public/canvas-runtime/v1/legacy.js'), 'publication-only');
    await writeFile(path.join(root, 'shared.js'), 'export const shared = "unique-shared-ui-code";');
    await writeFile(path.join(root, 'canvas.css'), 'body {color: rgb(1, 2, 3)}');
    await writeFile(
      path.join(root, 'index.html'),
      '<script type="module" src="/main.js"></script>',
    );
    await writeFile(
      path.join(root, 'main.js'),
      'import url from "virtual:canvas-runtime"; import {shared} from "./shared.js"; globalThis.resources = {url,shared};',
    );
    await build({
      root,
      base: '/_spa/',
      configFile: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'canvas-fixture',
          load(id) {
            if (id.endsWith('/canvas-runtime/src/index.tsx'))
              return 'import {shared} from "/shared.js"; import "/canvas.css"; globalThis.canvasValue = shared;';
            if (/canvas-runtime\/src\/addons\/(?:highlight|mermaid)\.ts$/.test(id))
              return 'import {shared} from "/shared.js"; globalThis.addonValue = shared;';
          },
        },
        canvasRuntime(),
      ],
      build: {
        minify: false,
        rolldownOptions: {
          input: path.join(root, 'main.js'),
          preserveEntrySignatures: 'allow-extension',
        },
      },
    });
    const assets = await readdir(path.join(root, 'dist/assets'));
    const manifestFile = assets.find((file) => file.endsWith('.js.json'))!;
    expect(manifestFile).toBeTruthy();
    const manifest: CanvasRuntimeManifest = JSON.parse(
      await readFile(path.join(root, 'dist/assets', manifestFile), 'utf8'),
    );
    const code = await Promise.all(
      assets
        .filter((file) => file.endsWith('.js'))
        .map((file) => readFile(path.join(root, 'dist/assets', file), 'utf8')),
    );
    expect(code.join('\n').match(/unique-shared-ui-code/g)).toHaveLength(1);
    expect(await readdir(path.join(root, 'dist'))).not.toContain('canvas-runtime');
    expect(await readFile(path.join(root, 'public/canvas-runtime/v1/legacy.js'), 'utf8')).toBe(
      'publication-only',
    );
    expect(manifest.styles).toHaveLength(1);
    for (const module of manifest.modules) {
      const source = await readFile(path.join(root, 'dist', module.id), 'utf8');
      for (const reference of module.imports) {
        expect(JSON.parse(source.slice(reference.start, reference.end))).toContain('.js');
        expect(manifest.modules.some((item) => item.id === reference.target)).toBe(true);
      }
    }
    expect(manifest.modules.some((module) => module.id === manifest.entries.runtime)).toBe(true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

it('serves an in-memory development runtime without writing a publication build', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'canvas-dev-'));
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, entries: [] },
    plugins: [canvasRuntime()],
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Dev server has no port');
    const response = await fetch(`http://127.0.0.1:${address.port}/@lobe-canvas/runtime.json`);
    expect(response.status).toBe(200);
    const { bundle } = await response.json();
    expect(bundle.modules).toHaveLength(3);
    expect(bundle.styles.length).toBeGreaterThan(0);
    for (const entry of Object.values(bundle.entries))
      expect(
        bundle.modules.some(
          (module: { code: string; id: string }) =>
            module.id === entry && module.code.length > 1000,
        ),
      ).toBe(true);
    expect(await readdir(root)).not.toContain('dist');
  } finally {
    await server.close();
    await rm(root, { force: true, recursive: true });
  }
}, 30_000);
