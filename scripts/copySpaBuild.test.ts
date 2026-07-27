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

    for (const dir of ['assets', 'i18n', 'model-bank', 'shiki', 'vendor']) {
      const sourceDir = path.join(root, 'dist/desktop', dir);
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(path.join(sourceDir, `${dir}.js`), `export default '${dir}';`);
    }

    copySpaBuild(root);

    for (const dir of ['assets', 'i18n', 'model-bank', 'shiki', 'vendor']) {
      expect(existsSync(path.join(root, 'public/_spa', dir, `${dir}.js`))).toBe(true);
    }
  });
});
