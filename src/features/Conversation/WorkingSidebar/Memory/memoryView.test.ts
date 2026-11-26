import { describe, expect, it } from 'vitest';

import {
  findMemoryIndex,
  groupMemoryFiles,
  memoryFilePortalTarget,
  shortenMemoryDir,
} from './memoryView';

const file = (relativePath: string, type?: string, updatedAt = 0) => ({
  isIndex: relativePath === 'MEMORY.md',
  name: relativePath,
  path: `/memory/${relativePath}`,
  relativePath,
  size: 1,
  type,
  updatedAt,
});

describe('groupMemoryFiles', () => {
  it('orders the known types, then untyped files, leaving out the index and empty groups', () => {
    const groups = groupMemoryFiles([
      file('a.md', 'reference'),
      file('MEMORY.md'),
      file('b.md', 'custom'),
      file('c.md', 'user'),
      file('d.md'),
      file('e.md', 'user'),
    ]);

    expect(groups.map((group) => [group.key, group.files.map((f) => f.relativePath)])).toEqual([
      ['user', ['c.md', 'e.md']],
      ['reference', ['a.md']],
      ['other', ['b.md', 'd.md']],
    ]);
  });

  it('lists the most recently updated memory of a group first', () => {
    const groups = groupMemoryFiles([
      file('old.md', 'feedback', 100),
      file('newest.md', 'feedback', 300),
      file('middle.md', 'feedback', 200),
    ]);

    expect(groups[0].files.map((f) => f.relativePath)).toEqual([
      'newest.md',
      'middle.md',
      'old.md',
    ]);
  });

  it('returns no groups for no files, or for only the index', () => {
    expect(groupMemoryFiles([])).toEqual([]);
    expect(groupMemoryFiles([file('MEMORY.md')])).toEqual([]);
  });
});

describe('findMemoryIndex', () => {
  it('finds the MEMORY.md index, if there is one', () => {
    expect(findMemoryIndex([file('a.md', 'user'), file('MEMORY.md')])?.relativePath).toBe(
      'MEMORY.md',
    );
    expect(findMemoryIndex([file('a.md', 'user')])).toBeUndefined();
  });
});

describe('shortenMemoryDir', () => {
  it('shows the home directory as ~ and folds the project key', () => {
    expect(
      shortenMemoryDir('/home/ubuntu/.claude/projects/-home-ubuntu-develop-lobe-admin/memory'),
    ).toBe('~/.claude/projects/…/memory');
    expect(shortenMemoryDir('/Users/me/.claude/projects/-Users-me-repo/memory')).toBe(
      '~/.claude/projects/…/memory',
    );
    expect(shortenMemoryDir('C:\\Users\\me\\.claude\\projects\\C--repo\\memory')).toBe(
      '~\\.claude\\projects\\…\\memory',
    );
  });

  it('keeps a custom config dir outside home as it is, folding only the project key', () => {
    expect(shortenMemoryDir('/opt/claude/projects/-repo/memory')).toBe(
      '/opt/claude/projects/…/memory',
    );
  });

  it('does not take a home-like prefix that is not a whole path segment', () => {
    expect(shortenMemoryDir('/rootless/memory')).toBe('/rootless/memory');
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
