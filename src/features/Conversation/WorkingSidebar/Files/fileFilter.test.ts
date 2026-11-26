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

  it('filters a large project in linear time', () => {
    // 20,000 directories x 2 files. Scanning every file per directory took
    // seconds here; one pass over the files takes a few milliseconds.
    const large: ProjectFileIndexEntry[] = [];
    for (let dir = 0; dir < 20_000; dir += 1) {
      const directory = `pkg${dir}/`;
      large.push({
        isDirectory: true,
        name: `pkg${dir}`,
        path: `/repo/pkg${dir}`,
        relativePath: directory,
      });
      for (let file = 0; file < 2; file += 1) {
        const relativePath = `${directory}file${file}.ts`;
        large.push({
          gitIgnored: dir % 2 === 1,
          isDirectory: false,
          name: `file${file}.ts`,
          path: `/repo/${relativePath}`,
          relativePath,
        });
      }
    }

    const startedAt = performance.now();
    const result = filterProjectFileEntries(large, new Set(), {
      changedOnly: false,
      hideIgnored: true,
    });
    const elapsed = performance.now() - startedAt;

    // Half the directories hold only ignored files, so they drop out entirely.
    expect(result).toHaveLength(10_000 * 3);
    expect(elapsed).toBeLessThan(300);
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
