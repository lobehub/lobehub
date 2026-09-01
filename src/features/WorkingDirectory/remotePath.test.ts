import type { DeviceListDirEntry } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  createRemoteDirectoryQuery,
  ensureRemotePathTrailingSeparator,
  filterRemoteDirectoryEntries,
  inferRemotePathStyle,
  isSameRemotePath,
  splitRemotePathQuery,
} from './remotePath';

const entry = (name: string, options: Partial<DeviceListDirEntry> = {}): DeviceListDirEntry => ({
  hidden: name.startsWith('.'),
  isSymlink: false,
  name,
  path: `/home/user/${name}`,
  type: 'directory',
  ...options,
});

describe('remotePath', () => {
  it('represents an initial directory without treating its last segment as a fuzzy suffix', () => {
    const posixQuery = createRemoteDirectoryQuery('/home/user/projects');
    expect(splitRemotePathQuery(posixQuery, 'posix')).toEqual({
      directory: '/home/user/projects',
      suffix: '',
    });

    const windowsQuery = createRemoteDirectoryQuery('C:\\Users\\alice\\projects');
    expect(splitRemotePathQuery(windowsQuery, 'windows')).toEqual({
      directory: 'C:\\Users\\alice\\projects',
      suffix: '',
    });
  });

  it('splits a POSIX path into a remote directory and local child suffix', () => {
    expect(splitRemotePathQuery('/home/user/proj', 'posix')).toEqual({
      directory: '/home/user',
      suffix: 'proj',
    });
    expect(splitRemotePathQuery('/home/user/', 'posix')).toEqual({
      directory: '/home/user',
      suffix: '',
    });
    expect(splitRemotePathQuery('/project', 'posix')).toEqual({
      directory: '/',
      suffix: 'project',
    });
  });

  it('supports Windows drive roots and mixed separators', () => {
    expect(splitRemotePathQuery('C:\\Users/alice\\proj', 'windows')).toEqual({
      directory: 'C:\\Users/alice',
      suffix: 'proj',
    });
    expect(splitRemotePathQuery('C:\\project', 'windows')).toEqual({
      directory: 'C:\\',
      suffix: 'project',
    });
    expect(splitRemotePathQuery('C:\\\\', 'windows')).toEqual({
      directory: 'C:\\',
      suffix: '',
    });
    expect(inferRemotePathStyle('C:/Users/alice')).toBe('windows');
    expect(ensureRemotePathTrailingSeparator('C:\\Users\\alice', 'windows')).toBe(
      'C:\\Users\\alice\\',
    );
  });

  it('compares Windows paths case-insensitively while preserving POSIX case', () => {
    expect(isSameRemotePath('C:/Users/Alice/', 'c:\\users\\alice', 'windows')).toBe(true);
    expect(isSameRemotePath('/Users/Alice', '/users/alice', 'posix')).toBe(false);
    expect(isSameRemotePath('/home/user/', '/home/user', 'posix')).toBe(true);
  });

  it('promotes exact prefixes over incidental fuzzy matches', () => {
    const entries = [entry('my-project'), entry('project-z'), entry('project')];

    const result = filterRemoteDirectoryEntries(entries, 'pro');

    expect(result.slice(0, 2).every((item) => item.name.startsWith('pro'))).toBe(true);
    expect(result[2]?.name).toBe('my-project');
  });

  it('keeps hidden folders while excluding files from the picker', () => {
    const entries = [
      entry('.agents'),
      entry('src'),
      entry('package.json', { path: '/home/user/package.json', type: 'file' }),
    ];

    expect(filterRemoteDirectoryEntries(entries, 'agents').map((item) => item.name)).toContain(
      '.agents',
    );
    expect(filterRemoteDirectoryEntries(entries, '').map((item) => item.name)).not.toContain(
      'package.json',
    );
    expect(filterRemoteDirectoryEntries(entries, 'package')).toEqual([]);
  });
});
