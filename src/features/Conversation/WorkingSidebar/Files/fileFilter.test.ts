import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import { filterProjectFileEntries, mergeMissingDeletedEntries } from './fileFilter';

const entries: ProjectFileIndexEntry[] = [
  { isDirectory: true, name: 'src', path: '/repo/src', relativePath: 'src/' },
  {
    isDirectory: true,
    name: 'components',
    path: '/repo/src/components',
    relativePath: 'src/components/',
  },
  {
    isDirectory: false,
    name: 'Button.tsx',
    path: '/repo/src/components/Button.tsx',
    relativePath: 'src/components/Button.tsx',
  },
  {
    isDirectory: false,
    name: 'index.ts',
    path: '/repo/src/index.ts',
    relativePath: 'src/index.ts',
  },
  {
    gitIgnored: true,
    isDirectory: true,
    name: 'dist',
    path: '/repo/dist',
    relativePath: 'dist/',
  },
];

describe('filterProjectFileEntries', () => {
  it('preserves all entries when no display filter is active', () => {
    expect(
      filterProjectFileEntries(entries, new Set(), { changedOnly: false, hideIgnored: false }),
    ).toEqual(entries);
  });

  it('keeps changed files and their ancestor directories only', () => {
    const result = filterProjectFileEntries(entries, new Set(['src/components/Button.tsx']), {
      changedOnly: true,
      hideIgnored: false,
    });

    expect(result.map((entry) => entry.relativePath)).toEqual([
      'src/',
      'src/components/',
      'src/components/Button.tsx',
    ]);
  });

  it('excludes ignored entries without dropping parents of visible files', () => {
    const result = filterProjectFileEntries(entries, new Set(), {
      changedOnly: false,
      hideIgnored: true,
    });

    expect(result.map((entry) => entry.relativePath)).toEqual([
      'src/',
      'src/components/',
      'src/components/Button.tsx',
      'src/index.ts',
    ]);
  });
});

describe('mergeMissingDeletedEntries', () => {
  it('recreates missing staged deletions and their absent ancestor directories', () => {
    const result = mergeMissingDeletedEntries(
      entries,
      ['src/components/Button.tsx', 'removed/deep/file.ts'],
      '/repo',
    );

    expect(result.map((entry) => entry.relativePath)).toEqual([
      ...entries.map((entry) => entry.relativePath),
      'removed/',
      'removed/deep/',
      'removed/deep/file.ts',
    ]);
    expect(result.at(-1)).toMatchObject({
      isDirectory: false,
      name: 'file.ts',
      path: '/repo/removed/deep/file.ts',
    });
  });
});
