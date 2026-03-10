import { constants } from 'node:fs';
import { access, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

import type { MoveFileResultItem, MoveFilesParams } from '../types';

export async function moveLocalFiles({ items }: MoveFilesParams): Promise<MoveFileResultItem[]> {
  const results: MoveFileResultItem[] = [];

  if (!items || items.length === 0) {
    return [];
  }

  for (const item of items) {
    const { oldPath: sourcePath, newPath } = item;
    const resultItem: MoveFileResultItem = {
      newPath: undefined,
      sourcePath,
      success: false,
    };

    if (!sourcePath || !newPath) {
      resultItem.error = 'Both oldPath and newPath are required for each item.';
      results.push(resultItem);
      continue;
    }

    try {
      // Check if source exists
      try {
        await access(sourcePath, constants.F_OK);
      } catch (accessError: any) {
        if (accessError.code === 'ENOENT') {
          throw new Error(`Source path not found: ${sourcePath}`, { cause: accessError });
        } else {
          throw new Error(
            `Permission denied accessing source path: ${sourcePath}. ${accessError.message}`,
            { cause: accessError },
          );
        }
      }

      // Check if paths are identical
      if (path.normalize(sourcePath) === path.normalize(newPath)) {
        resultItem.success = true;
        resultItem.newPath = newPath;
        results.push(resultItem);
        continue;
      }

      // Ensure target directory exists
      const targetDir = path.dirname(newPath);
      await mkdir(targetDir, { recursive: true });

      // Execute move
      await rename(sourcePath, newPath);
      resultItem.success = true;
      resultItem.newPath = newPath;
    } catch (error) {
      let errorMessage = (error as Error).message;
      const code = (error as any).code;
      if (code === 'ENOENT') errorMessage = `Source path not found: ${sourcePath}.`;
      else if (code === 'EPERM' || code === 'EACCES')
        errorMessage = `Permission denied to move the item at ${sourcePath}. Check file/folder permissions.`;
      else if (code === 'EBUSY')
        errorMessage = `The file or directory at ${sourcePath} or ${newPath} is busy or locked by another process.`;
      else if (code === 'EXDEV')
        errorMessage = `Cannot move across different file systems or drives. Source: ${sourcePath}, Target: ${newPath}.`;
      else if (code === 'EISDIR')
        errorMessage = `Cannot overwrite a directory with a file, or vice versa. Source: ${sourcePath}, Target: ${newPath}.`;
      else if (code === 'ENOTEMPTY') errorMessage = `The target directory ${newPath} is not empty.`;
      else if (code === 'EEXIST')
        errorMessage = `An item already exists at the target path: ${newPath}.`;
      resultItem.error = errorMessage;
    }
    results.push(resultItem);
  }

  return results;
}
