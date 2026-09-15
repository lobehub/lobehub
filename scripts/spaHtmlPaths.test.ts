import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { requireWorkbenchHtmlPath, resolveWorkbenchHtmlPath } from './spaHtmlPaths';

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('resolveWorkbenchHtmlPath', () => {
  it('prefers dist/workbench/index.workbench.html when both files exist', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spa-html-workbench-'));
    testRoots.push(root);

    mkdirSync(path.join(root, 'dist/workbench'), { recursive: true });
    writeFileSync(path.join(root, 'dist/workbench/index.workbench.html'), 'preferred');
    writeFileSync(path.join(root, 'dist/workbench/index.html'), 'fallback');

    expect(resolveWorkbenchHtmlPath(root)).toBe(
      path.resolve(root, 'dist/workbench/index.workbench.html'),
    );
  });

  it('falls back to dist/workbench/index.html', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spa-html-workbench-fallback-'));
    testRoots.push(root);

    mkdirSync(path.join(root, 'dist/workbench'), { recursive: true });
    writeFileSync(path.join(root, 'dist/workbench/index.html'), 'fallback');

    expect(resolveWorkbenchHtmlPath(root)).toBe(path.resolve(root, 'dist/workbench/index.html'));
  });

  it('returns undefined when the Workbench HTML is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spa-html-workbench-missing-'));
    testRoots.push(root);

    expect(resolveWorkbenchHtmlPath(root)).toBeUndefined();
  });
});

describe('requireWorkbenchHtmlPath', () => {
  it('throws when the Workbench HTML is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spa-html-workbench-required-'));
    testRoots.push(root);

    expect(() => requireWorkbenchHtmlPath(root)).toThrow(/Workbench SPA build is required/);
  });
});
