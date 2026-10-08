import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dirRendererSource, treeRendererSource } from '../rendererSource';

const entry = (filePath: string, sha: string) => ({ path: filePath, sha256: sha, size: 1 });

describe('treeRendererSource', () => {
  const source = treeRendererSource({
    builtinDir: '/app/core.asar',
    builtinTree: [
      entry('dist/renderer/assets/same.js', 'a'.repeat(64)),
      entry('dist/renderer/assets/old-name.js', 'b'.repeat(64)),
      entry('dist/main/index.js', 'm'.repeat(64)),
    ],
    storeDir: '/ota/store',
    tree: [
      entry('dist/renderer/assets/same.js', 'a'.repeat(64)),
      entry('dist/renderer/assets/renamed.js', 'b'.repeat(64)),
      entry('dist/renderer/assets/changed.js', 'c'.repeat(64)),
      entry('dist/renderer/assets/(home)-x.js', 'd'.repeat(64)),
      entry('dist/renderer/apps/desktop/index.html', 'e'.repeat(64)),
      entry('dist/main/index.js', 'f'.repeat(64)),
    ],
  });

  it('reads unchanged content from the builtin archive', () => {
    expect(source.resolve('assets/same.js')).toBe(
      path.join('/app/core.asar', 'dist/renderer/assets/same.js'),
    );
  });

  it('matches builtin content by hash even when the path moved', () => {
    expect(source.resolve('assets/renamed.js')).toBe(
      path.join('/app/core.asar', 'dist/renderer/assets/old-name.js'),
    );
  });

  it('reads changed content from the object store', () => {
    expect(source.resolve('assets/changed.js')).toBe(path.join('/ota/store', 'c'.repeat(64)));
  });

  it('accepts URL-encoded and Windows-style relative paths', () => {
    expect(source.resolve('assets/%28home%29-x.js')).toBe(path.join('/ota/store', 'd'.repeat(64)));
    expect(source.resolve('apps\\desktop\\index.html')).toBe(
      path.join('/ota/store', 'e'.repeat(64)),
    );
  });

  it('only serves renderer entries of the tree', () => {
    expect(source.resolve('../main/index.js')).toBeNull();
    expect(source.resolve('assets/unknown.js')).toBeNull();
    expect(source.resolve('assets/%E0%A4%A.js')).toBeNull();
  });
});

describe('dirRendererSource', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'renderer-source-'));
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'assets', 'a.js'), 'a');
  });

  afterEach(() => rmSync(root, { force: true, recursive: true }));

  it('resolves existing files under the root', () => {
    const source = dirRendererSource(root);
    expect(source.resolve('assets/a.js')).toBe(path.join(root, 'assets', 'a.js'));
    expect(source.resolve('assets/missing.js')).toBeNull();
  });
});
