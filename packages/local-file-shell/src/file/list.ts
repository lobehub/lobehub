import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { SYSTEM_FILES_TO_IGNORE } from '@lobechat/file-loaders';

import type { FileEntry, ListFilesParams, ListFilesResult } from '../types';

export interface ListFilesOptions {
  /** Whether to filter out system files like .DS_Store, Thumbs.db, etc. */
  ignoreSystemFiles?: boolean;
}

export async function listLocalFiles(
  { path: dirPath, sortBy = 'modifiedTime', sortOrder = 'desc', limit = 100 }: ListFilesParams,
  options?: ListFilesOptions,
): Promise<ListFilesResult> {
  const { ignoreSystemFiles = true } = options || {};

  try {
    const entries = await readdir(dirPath);
    const results: FileEntry[] = [];

    for (const entry of entries) {
      if (ignoreSystemFiles && SYSTEM_FILES_TO_IGNORE.includes(entry)) {
        continue;
      }

      const fullPath = path.join(dirPath, entry);
      try {
        const stats = await stat(fullPath);
        const isDirectory = stats.isDirectory();
        results.push({
          createdTime: stats.birthtime,
          isDirectory,
          lastAccessTime: stats.atime,
          modifiedTime: stats.mtime,
          name: entry,
          path: fullPath,
          size: stats.size,
          type: isDirectory ? 'directory' : path.extname(entry).toLowerCase().replace('.', ''),
        });
      } catch {
        // Skip files we can't stat
      }
    }

    results.sort((a, b) => {
      let comparison: number;
      switch (sortBy) {
        case 'name': {
          comparison = (a.name || '').localeCompare(b.name || '');
          break;
        }
        case 'modifiedTime': {
          comparison = a.modifiedTime.getTime() - b.modifiedTime.getTime();
          break;
        }
        case 'createdTime': {
          comparison = a.createdTime.getTime() - b.createdTime.getTime();
          break;
        }
        case 'size': {
          comparison = a.size - b.size;
          break;
        }
        default: {
          comparison = a.modifiedTime.getTime() - b.modifiedTime.getTime();
        }
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    const totalCount = results.length;
    return { files: results.slice(0, limit), totalCount };
  } catch {
    return { files: [], totalCount: 0 };
  }
}
