import { describe, expect, it } from 'vitest';

import { type StorageAnalysisResult, withoutDeleted } from './analysis';

const result: StorageAnalysisResult = {
  categories: [
    { bytes: 700, category: 'dependencies', items: 2 },
    { bytes: 300, category: 'other', items: 1 },
  ],
  items: [
    {
      bytes: 500,
      category: 'dependencies',
      isDirectory: true,
      path: 'app/node_modules',
      regenerable: true,
    },
    {
      bytes: 200,
      category: 'dependencies',
      isDirectory: true,
      path: 'tool/.venv',
      regenerable: true,
    },
    { bytes: 300, category: 'other', isDirectory: false, path: 'app/data.bin', regenerable: false },
  ],
  largestDirectories: [
    { bytes: 800, path: 'app' },
    { bytes: 500, path: 'app/node_modules' },
    { bytes: 200, path: 'tool' },
  ],
  largestFiles: [
    { bytes: 300, category: 'other', path: 'app/data.bin' },
    { bytes: 100, category: 'dependencies', path: 'app/node_modules/x/big.js' },
  ],
  totalBytes: 1000,
};

describe('withoutDeleted', () => {
  it('should take deleted items out and their bytes off every figure', () => {
    const next = withoutDeleted(result, [result.items[0]]);

    expect(next.totalBytes).toBe(500);
    expect(next.categories).toEqual([
      { bytes: 200, category: 'dependencies', items: 1 },
      { bytes: 300, category: 'other', items: 1 },
    ]);
    expect(next.items.map((item) => item.path)).toEqual(['tool/.venv', 'app/data.bin']);
    // Files inside a deleted folder go with it; the folder holding it shrinks.
    expect(next.largestFiles.map((entry) => entry.path)).toEqual(['app/data.bin']);
    expect(next.largestDirectories).toEqual([
      { bytes: 300, path: 'app' },
      { bytes: 200, path: 'tool' },
    ]);
  });

  it('should not treat a sibling with the same prefix as inside a deleted folder', () => {
    const sibling = {
      ...result,
      items: [
        ...result.items,
        {
          bytes: 1,
          category: 'other' as const,
          isDirectory: false,
          path: 'app/node_modules2',
          regenerable: false,
        },
      ],
    };

    const next = withoutDeleted(sibling, [result.items[0]]);

    expect(next.items.map((item) => item.path)).toContain('app/node_modules2');
  });

  it('should leave the result as it was when nothing was deleted', () => {
    expect(withoutDeleted(result, [])).toBe(result);
  });
});
