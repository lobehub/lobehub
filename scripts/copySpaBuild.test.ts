import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { copySpaBuild } from './copySpaBuildCore';

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('copySpaBuild', () => {
  it('publishes on-demand chunk directories required by the production SPA', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'copy-spa-build-'));
    testRoots.push(root);

    for (const dir of ['assets', 'devtools', 'i18n', 'model-bank', 'shiki', 'vendor']) {
      const sourceDir = path.join(root, 'dist/desktop', dir);
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(path.join(sourceDir, `${dir}.js`), `export default '${dir}';`);
    }

    copySpaBuild(root);

    for (const dir of ['assets', 'devtools', 'i18n', 'model-bank', 'shiki', 'vendor']) {
      expect(existsSync(path.join(root, 'public/_spa', dir, `${dir}.js`))).toBe(true);
    }
  });

  // `new Worker` only accepts a same-origin script, so these are requested from the
  // page's own origin rather than the asset host — which means they have to reach
  // `public/`, and at its root, because that is the path the build emits.
  it('publishes workers to the public root, outside the per-variant directories', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'copy-spa-build-workers-'));
    testRoots.push(root);

    for (const variant of ['desktop', 'workbench']) {
      const sourceDir = path.join(root, `dist/${variant}/app-workers`);
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(path.join(sourceDir, 'worker-abc.js'), 'self.onmessage = () => {};');
    }

    copySpaBuild(root);

    expect(existsSync(path.join(root, 'public/app-workers/worker-abc.js'))).toBe(true);
    expect(existsSync(path.join(root, 'public/_spa/app-workers'))).toBe(false);
    expect(existsSync(path.join(root, 'public/_spa-workbench/app-workers'))).toBe(false);
  });

  it('runs through the production Node entrypoint', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'copy-spa-build-entry-'));
    testRoots.push(root);

    const sourceDir = path.join(root, 'dist/desktop/model-bank');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'catalog.js'), 'export default [];');

    execFileSync(process.execPath, [path.resolve(import.meta.dirname, 'copySpaBuild.mts'), root], {
      cwd: tmpdir(),
      stdio: 'pipe',
    });

    expect(existsSync(path.join(root, 'public/_spa/model-bank/catalog.js'))).toBe(true);
  });

  it('publishes Workbench chunks under an isolated public asset root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'copy-spa-workbench-'));
    testRoots.push(root);

    const sourceDir = path.join(root, 'dist/workbench/assets');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'workbench.js'), 'export default true;');

    copySpaBuild(root);

    expect(existsSync(path.join(root, 'public/_spa-workbench/assets/workbench.js'))).toBe(true);
    expect(existsSync(path.join(root, 'public/_spa/assets/workbench.js'))).toBe(false);
  });
});
