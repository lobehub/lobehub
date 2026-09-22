import { describe, expect, it } from 'vitest';

import {
  type BreadcrumbEntry,
  groupChildrenByParent,
  listDirectoryChildren,
  toBreadcrumbSegments,
} from './filePathBreadcrumb';

const names = (filePath: string, rootPath?: string) =>
  toBreadcrumbSegments(filePath, rootPath).map((segment) => segment.name);

describe('toBreadcrumbSegments', () => {
  it('anchors on the project root folder name', () => {
    expect(names('/Users/a/work/my-app/src/index.ts', '/Users/a/work/my-app')).toEqual([
      'my-app',
      'src',
      'index.ts',
    ]);
  });

  it('keeps every level of a deep path', () => {
    // The row ellipsizes individual crumbs when it runs out of width, so a
    // deep path must not be pre-collapsed while there is still room.
    expect(
      names('/Users/a/work/my-app/src/features/Portal/LocalFile/Body.tsx', '/Users/a/work/my-app'),
    ).toEqual(['my-app', 'src', 'features', 'Portal', 'LocalFile', 'Body.tsx']);
  });

  it('carries the absolute and root-relative path of each level', () => {
    expect(toBreadcrumbSegments('/w/app/src/index.ts', '/w/app')).toEqual([
      { name: 'app', path: '/w/app', relativePath: '' },
      { name: 'src', path: '/w/app/src', relativePath: 'src' },
      { name: 'index.ts', path: '/w/app/src/index.ts', relativePath: 'src/index.ts' },
    ]);
  });

  it('leaves a path outside the root without a relative path', () => {
    const segments = toBreadcrumbSegments('/etc/hosts', '/Users/a/work/my-app');

    expect(segments.map((s) => s.name)).toEqual(['etc', 'hosts']);
    expect(segments.every((s) => s.relativePath === undefined)).toBe(true);
  });

  it('handles Windows separators', () => {
    expect(toBreadcrumbSegments('C:\\repo\\src\\main.rs', 'C:\\repo')).toEqual([
      { name: 'repo', path: 'C:\\repo', relativePath: '' },
      { name: 'src', path: 'C:\\repo\\src', relativePath: 'src' },
      { name: 'main.rs', path: 'C:\\repo\\src\\main.rs', relativePath: 'src/main.rs' },
    ]);
  });

  it('returns nothing for an empty path', () => {
    expect(toBreadcrumbSegments('')).toEqual([]);
  });
});

describe('listDirectoryChildren', () => {
  // Directory entries arrive from the project index with a trailing slash.
  const entries: BreadcrumbEntry[] = [
    { isDirectory: true, name: 'src', path: '/w/app/src', relativePath: 'src/' },
    {
      isDirectory: false,
      name: 'index.ts',
      path: '/w/app/src/index.ts',
      relativePath: 'src/index.ts',
    },
    { isDirectory: true, name: 'ui', path: '/w/app/src/ui', relativePath: 'src/ui/' },
    {
      isDirectory: false,
      name: 'Button.tsx',
      path: '/w/app/src/ui/Button.tsx',
      relativePath: 'src/ui/Button.tsx',
    },
    { isDirectory: false, name: 'README.md', path: '/w/app/README.md', relativePath: 'README.md' },
  ];

  it('lists only immediate children, folders first', () => {
    expect(listDirectoryChildren(entries, 'src').map((e) => e.name)).toEqual(['ui', 'index.ts']);
  });

  it('accepts a directory path that already carries the index trailing slash', () => {
    expect(listDirectoryChildren(entries, 'src/').map((e) => e.name)).toEqual(['ui', 'index.ts']);
  });

  it('lists the root level for an empty relative path', () => {
    expect(listDirectoryChildren(entries, '').map((e) => e.name)).toEqual(['src', 'README.md']);
  });

  it('does not treat a sibling with a shared name prefix as a child', () => {
    const withPrefixSibling: BreadcrumbEntry[] = [
      ...entries,
      { isDirectory: false, name: 'a.ts', path: '/w/app/srcgen/a.ts', relativePath: 'srcgen/a.ts' },
    ];

    expect(listDirectoryChildren(withPrefixSibling, 'src').map((e) => e.name)).toEqual([
      'ui',
      'index.ts',
    ]);
  });
});

describe('groupChildrenByParent', () => {
  const entries: BreadcrumbEntry[] = [
    { isDirectory: true, name: 'src', path: '/w/app/src', relativePath: 'src/' },
    { isDirectory: true, name: 'ui', path: '/w/app/src/ui', relativePath: 'src/ui/' },
    {
      isDirectory: false,
      name: 'Button.tsx',
      path: '/w/app/src/ui/Button.tsx',
      relativePath: 'src/ui/Button.tsx',
    },
    { isDirectory: false, name: 'README.md', path: '/w/app/README.md', relativePath: 'README.md' },
  ];

  it('keys every level by its parent, with the root under an empty string', () => {
    const byParent = groupChildrenByParent(entries);

    expect(byParent.get('')?.map((e) => e.name)).toEqual(['src', 'README.md']);
    expect(byParent.get('src')?.map((e) => e.name)).toEqual(['ui']);
    expect(byParent.get('src/ui')?.map((e) => e.name)).toEqual(['Button.tsx']);
  });

  it('has no entry for a folder that holds nothing', () => {
    expect(groupChildrenByParent(entries).get('src/ui/Button.tsx')).toBeUndefined();
  });
});
