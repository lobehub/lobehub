import { describe, expect, it } from 'vitest';

import { groupMemoryFiles, memoryFilePortalTarget } from './memoryView';

const file = (relativePath: string, type?: string) => ({
  isIndex: relativePath === 'MEMORY.md',
  name: relativePath,
  path: `/memory/${relativePath}`,
  relativePath,
  size: 1,
  type,
  updatedAt: 0,
});

describe('groupMemoryFiles', () => {
  it('orders the index, the known types, then untyped files, dropping empty groups', () => {
    const groups = groupMemoryFiles([
      file('a.md', 'reference'),
      file('MEMORY.md'),
      file('b.md', 'custom'),
      file('c.md', 'user'),
      file('d.md'),
      file('e.md', 'user'),
    ]);

    expect(groups.map((group) => [group.key, group.files.map((f) => f.relativePath)])).toEqual([
      ['index', ['MEMORY.md']],
      ['user', ['c.md', 'e.md']],
      ['reference', ['a.md']],
      ['other', ['b.md', 'd.md']],
    ]);
  });

  it('returns no groups for no files', () => {
    expect(groupMemoryFiles([])).toEqual([]);
  });
});

describe('memoryFilePortalTarget', () => {
  it('roots the tab at the memory directory and keeps it visible outside the project', () => {
    expect(memoryFilePortalTarget(file('about.md', 'user'), '/memory', 'device-1')).toEqual({
      allowExternalFilePreview: true,
      deviceId: 'device-1',
      filePath: '/memory/about.md',
      workingDirectory: '/memory',
    });
  });
});
