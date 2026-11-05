// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { importsPlainCss, readPlainCssImporters } from '.';

const repoRoot = path.resolve(import.meta.dirname, '../..');

describe('plainCssImporters.json', () => {
  it('lists only files that still import a plain stylesheet', () => {
    const stale = readPlainCssImporters().filter((file) => {
      const absolute = path.join(repoRoot, file);
      return !existsSync(absolute) || !importsPlainCss(readFileSync(absolute, 'utf8'));
    });
    expect(stale).toEqual([]);
  });

  it('stays sorted so removals diff as single lines', () => {
    const files = readPlainCssImporters();
    expect(files).toEqual([...files].sort());
  });

  it('tells plain stylesheets apart from CSS modules and package stylesheets', () => {
    expect(importsPlainCss("import './a.css';")).toBe(true);
    expect(importsPlainCss("import '@/styles/stylex.css';")).toBe(true);
    expect(importsPlainCss("import styles from './a.module.css';")).toBe(false);
    expect(importsPlainCss("import '@lobehub/ui/style.css';")).toBe(false);
  });
});
