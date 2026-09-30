import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';

/** `lstat` that reports a missing path as `undefined` instead of throwing. */
export const lstatIfExists = async (target: string): Promise<Stats | undefined> => {
  try {
    return await lstat(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw error;
  }
};

/**
 * Whether `target` is already taken by an entry other than `source`.
 *
 * `fs.rename` silently replaces an existing file on POSIX, so move and rename
 * check this first and refuse instead of destroying the user's file. A
 * case-only rename (`a.ts` → `A.ts`) on a case-insensitive disk resolves both
 * names to the same entry, which must stay allowed — hence the inode compare
 * rather than a bare existence check.
 */
export const isTakenByAnotherEntry = async (source: string, target: string): Promise<boolean> => {
  const targetStats = await lstatIfExists(target);
  if (!targetStats) return false;

  const sourceStats = await lstatIfExists(source);
  if (!sourceStats) return true;

  return sourceStats.ino !== targetStats.ino || sourceStats.dev !== targetStats.dev;
};
