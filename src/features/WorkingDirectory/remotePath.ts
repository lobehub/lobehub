import type { DeviceListDirEntry, DevicePathStyle } from '@lobechat/types';
import Fuse from 'fuse.js';

export interface RemotePathQuery {
  directory?: string;
  suffix: string;
}

const WINDOWS_DRIVE_ROOT = /^([A-Z]:)[/\\]+$/i;

export const inferRemotePathStyle = (value: string): DevicePathStyle =>
  /^[A-Z]:[/\\]/i.test(value) || value.includes('\\') ? 'windows' : 'posix';

export const getRemotePathSeparator = (style: DevicePathStyle): '/' | '\\' =>
  style === 'windows' ? '\\' : '/';

const trimTrailingSeparators = (value: string, style: DevicePathStyle): string => {
  if (value === '/') return value;
  if (style === 'windows') {
    const driveRoot = value.match(WINDOWS_DRIVE_ROOT);
    if (driveRoot) return `${driveRoot[1]}\\`;
  }
  return style === 'windows' ? value.replace(/[/\\]+$/, '') : value.replace(/\/+$/, '');
};

export const ensureRemotePathTrailingSeparator = (
  value: string,
  style: DevicePathStyle,
): string => {
  const separator = getRemotePathSeparator(style);
  if (!value) return value;
  return value.endsWith('/') || value.endsWith('\\') ? value : `${value}${separator}`;
};

/** Represent a known directory as a query with no fuzzy child suffix. */
export const createRemoteDirectoryQuery = (value: string | undefined): string => {
  const path = value?.trim();
  return path ? ensureRemotePathTrailingSeparator(path, inferRemotePathStyle(path)) : '';
};

/**
 * Split a typed path into the directory to list remotely and the child-name
 * suffix to fuzzy-match locally. Windows accepts either slash style.
 */
export const splitRemotePathQuery = (value: string, style: DevicePathStyle): RemotePathQuery => {
  const slashIndex = value.lastIndexOf('/');
  const separatorIndex =
    style === 'windows' ? Math.max(slashIndex, value.lastIndexOf('\\')) : slashIndex;
  if (separatorIndex < 0) return { suffix: value };

  const directory = trimTrailingSeparators(value.slice(0, separatorIndex + 1), style);
  return {
    directory: directory || getRemotePathSeparator(style),
    suffix: value.slice(separatorIndex + 1),
  };
};

const normalizeRemotePathForCompare = (value: string, style: DevicePathStyle): string => {
  const trimmed = trimTrailingSeparators(value.trim(), style);
  const normalized = style === 'windows' ? trimmed.replaceAll('/', '\\').toLowerCase() : trimmed;
  return normalized || getRemotePathSeparator(style);
};

export const isSameRemotePath = (
  left: string | undefined,
  right: string | undefined,
  style: DevicePathStyle,
): boolean => {
  if (!left || !right) return false;
  return normalizeRemotePathForCompare(left, style) === normalizeRemotePathForCompare(right, style);
};

/** Match only the child suffix; the directory prefix has already been resolved remotely. */
export const filterRemoteDirectoryEntries = (
  entries: DeviceListDirEntry[],
  suffix: string,
): DeviceListDirEntry[] => {
  const directories = entries.filter((entry) => entry.type === 'directory');
  const query = suffix.trim();
  if (!query) return directories;

  const normalizedQuery = query.toLowerCase();
  const results = new Fuse(directories, {
    ignoreLocation: true,
    includeScore: true,
    keys: ['name'],
    threshold: 0.4,
  }).search(query);

  return results
    .sort((a, b) => {
      const aPrefix = a.item.name.toLowerCase().startsWith(normalizedQuery);
      const bPrefix = b.item.name.toLowerCase().startsWith(normalizedQuery);
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      return (a.score ?? 1) - (b.score ?? 1);
    })
    .map((result) => result.item);
};
