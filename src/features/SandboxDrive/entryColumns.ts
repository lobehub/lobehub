import dayjs from 'dayjs';

import { formatSize } from '@/utils/format';

/**
 * What the storage page's list shows after each name, the way a desktop file
 * manager's list view does: modified date, size, and kind.
 */
interface DriveListEntry {
  isDirectory: boolean;
  isGitRepository?: boolean;
  modifiedAt?: string;
  name: string;
  size?: number;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Folders first, then by name. */
export const sortDriveEntries = <T extends DriveListEntry>(entries: readonly T[]): T[] =>
  [...entries].sort(
    (a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name),
  );

/**
 * Absolute, so it fits its column on one line: a relative "a few seconds ago"
 * wrapped there. The relative form is {@link entryModifiedRelative}, the tooltip.
 */
export const entryModified = (entry: DriveListEntry) =>
  entry.modifiedAt ? dayjs(entry.modifiedAt).format('YYYY-MM-DD HH:mm') : '';

export const entryModifiedRelative = (entry: DriveListEntry) =>
  entry.modifiedAt ? dayjs(entry.modifiedAt).fromNow() : undefined;

/** `--` for a folder, and a small file in bytes rather than "0.0 KB". */
export const entrySize = (entry: DriveListEntry) => {
  if (entry.isDirectory) return '--';
  if (entry.size === undefined) return '';

  return entry.size < 1024 ? `${entry.size} B` : formatSize(entry.size);
};

/** What an entry is, the way a file manager's Kind column says it. */
export const entryKind = (entry: DriveListEntry, t: Translate) => {
  if (entry.isGitRepository) return t('drive.explorer.kind.gitRepository');
  if (entry.isDirectory) return t('drive.explorer.kind.folder');
  const dot = entry.name.lastIndexOf('.');
  const extension = dot > 0 ? entry.name.slice(dot + 1) : '';

  return extension
    ? t('drive.explorer.kind.fileWithExtension', { extension: extension.toUpperCase() })
    : t('drive.explorer.kind.file');
};
