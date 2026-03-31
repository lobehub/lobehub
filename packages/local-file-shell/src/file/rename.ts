import { rename } from 'node:fs/promises';
import path from 'node:path';

import type { RenameFileParams, RenameFileResult } from '../types';

export async function renameLocalFile({
  path: currentPath,
  newName,
}: RenameFileParams): Promise<RenameFileResult> {
  if (!currentPath || !newName) {
    return { error: 'Both path and newName are required.', newPath: '', success: false };
  }

  // Prevent path traversal or invalid characters
  if (
    newName.includes('/') ||
    newName.includes('\\') ||
    newName === '.' ||
    newName === '..' ||
    /["*/:<>?\\|]/.test(newName)
  ) {
    return {
      error:
        'Invalid new name. It cannot contain path separators (/, \\), be "." or "..", or include characters like < > : " / \\ | ? *.',
      newPath: '',
      success: false,
    };
  }

  let newPath: string;
  try {
    const dir = path.dirname(currentPath);
    newPath = path.join(dir, newName);

    if (path.normalize(currentPath) === path.normalize(newPath)) {
      return { newPath, success: true };
    }
  } catch (error) {
    return {
      error: `Internal error calculating the new path: ${(error as Error).message}`,
      newPath: '',
      success: false,
    };
  }

  try {
    await rename(currentPath, newPath);
    return { newPath, success: true };
  } catch (error) {
    let errorMessage = (error as Error).message;
    const code = (error as any).code;
    if (code === 'ENOENT')
      errorMessage = `File or directory not found at the original path: ${currentPath}.`;
    else if (code === 'EPERM' || code === 'EACCES')
      errorMessage = `Permission denied to rename the item at ${currentPath}. Check file/folder permissions.`;
    else if (code === 'EBUSY')
      errorMessage = `The file or directory at ${currentPath} or ${newPath} is busy or locked by another process.`;
    else if (code === 'EISDIR' || code === 'ENOTDIR')
      errorMessage = `Cannot rename - conflict between file and directory. Source: ${currentPath}, Target: ${newPath}.`;
    else if (code === 'EEXIST')
      errorMessage = `Cannot rename: an item with the name '${newName}' already exists at this location.`;
    return { error: errorMessage, newPath: '', success: false };
  }
}
