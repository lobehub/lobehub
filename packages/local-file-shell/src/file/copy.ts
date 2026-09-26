import { cp } from 'node:fs/promises';
import path from 'node:path';

import type { CopyFileResultItem, CopyFilesParams } from '../types';
import { lstatIfExists } from './existingEntry';
import { resolveAgainstCwd } from './expandTilde';

/** Upper bound on `name copy N` probes; a folder with more duplicates than this is pathological. */
const MAX_COPY_NAME_ATTEMPTS = 1000;

/**
 * Finder's duplicate naming: `report.pdf` → `report copy.pdf` → `report copy 2.pdf`.
 * Duplicating a copy keeps counting from the original stem instead of stacking
 * (`report copy.pdf` → `report copy 2.pdf`, not `report copy copy.pdf`).
 * Folders and dotfiles keep their whole name as the stem.
 */
export const getCopyName = (name: string, isDirectory: boolean, attempt: number): string => {
  const ext = isDirectory ? '' : path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  const stem = base.replace(/ copy(?: \d+)?$/, '') || base;
  const suffix = attempt <= 1 ? ' copy' : ` copy ${attempt}`;
  return `${stem}${suffix}${ext}`;
};

const findFreeCopyPath = async (sourcePath: string, isDirectory: boolean): Promise<string> => {
  const dir = path.dirname(sourcePath);
  const name = path.basename(sourcePath);

  for (let attempt = 1; attempt <= MAX_COPY_NAME_ATTEMPTS; attempt++) {
    const candidate = path.join(dir, getCopyName(name, isDirectory, attempt));
    if (!(await lstatIfExists(candidate))) return candidate;
  }

  throw new Error(`Could not find a free name to duplicate ${sourcePath}.`);
};

const describeCopyError = (error: unknown, sourcePath: string, targetPath: string): string => {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EEXIST' || code === 'ERR_FS_CP_EEXIST')
    return `An item already exists at the target path: ${targetPath}.`;
  if (code === 'ERR_FS_CP_EINVAL') return `Cannot copy ${sourcePath} into itself.`;
  if (code === 'EPERM' || code === 'EACCES')
    return `Permission denied to copy ${sourcePath} to ${targetPath}.`;
  if (code === 'ENOENT') return `Source path not found: ${sourcePath}.`;
  return (error as Error).message;
};

/**
 * Copy files/folders (folders recursively). Never overwrites — an existing
 * target fails that item — and each item succeeds or fails independently, so
 * the caller can reconcile a partially applied batch.
 *
 * An item without `targetPath` is duplicated next to its source under the first
 * free Finder-style name (see {@link getCopyName}).
 */
export async function copyLocalFiles({
  cwd,
  items,
}: CopyFilesParams): Promise<CopyFileResultItem[]> {
  const results: CopyFileResultItem[] = [];
  if (!items || items.length === 0) return results;

  for (const item of items) {
    const sourcePath = resolveAgainstCwd(item.sourcePath, cwd) ?? item.sourcePath;
    const resultItem: CopyFileResultItem = { sourcePath, success: false };
    results.push(resultItem);

    if (!sourcePath) {
      resultItem.error = 'sourcePath is required for each item.';
      continue;
    }

    let targetPath = resolveAgainstCwd(item.targetPath, cwd);
    try {
      const sourceStats = await lstatIfExists(sourcePath);
      if (!sourceStats) {
        resultItem.error = `Source path not found: ${sourcePath}.`;
        continue;
      }

      targetPath ??= await findFreeCopyPath(sourcePath, sourceStats.isDirectory());

      // `errorOnExist` alone only guards files: copying a folder onto an
      // existing folder would merge into it and fail halfway through. Refuse
      // up front so a conflict never leaves a partial copy behind.
      if (await lstatIfExists(targetPath)) {
        resultItem.error = `An item already exists at the target path: ${targetPath}.`;
        continue;
      }

      await cp(sourcePath, targetPath, {
        errorOnExist: true,
        force: false,
        recursive: true,
        verbatimSymlinks: true,
      });
      resultItem.success = true;
      resultItem.targetPath = targetPath;
    } catch (error) {
      resultItem.error = describeCopyError(error, sourcePath, targetPath ?? '');
    }
  }

  return results;
}
