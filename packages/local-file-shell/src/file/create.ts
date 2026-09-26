import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CreateDirectoryParams, CreateEntryResult, CreateFileParams } from '../types';
import { resolveAgainstCwd } from './expandTilde';

const describeCreateError = (error: unknown, targetPath: string): string => {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EEXIST') return `An item already exists at ${targetPath}.`;
  if (code === 'EPERM' || code === 'EACCES') return `Permission denied to create ${targetPath}.`;
  if (code === 'ENOTDIR') return `A parent of ${targetPath} is a file, not a folder.`;
  if (code === 'ENOENT') return `The parent folder of ${targetPath} does not exist.`;
  return (error as Error).message;
};

/**
 * Create a new file. Unlike {@link writeLocalFile} this never overwrites: the
 * final path is opened with `wx`, so an existing file or folder fails the call.
 * Missing parent folders are created, so `a/b/c.ts` works in one step.
 */
export async function createLocalFile({
  content = '',
  cwd,
  path: rawPath,
}: CreateFileParams): Promise<CreateEntryResult> {
  if (!rawPath) return { error: 'Path cannot be empty', path: '', success: false };

  const filePath = resolveAgainstCwd(rawPath, cwd) ?? rawPath;

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' });
    return { path: filePath, success: true };
  } catch (error) {
    return { error: describeCreateError(error, filePath), path: filePath, success: false };
  }
}

/**
 * Create a new folder with a plain, non-recursive `mkdir`: an existing entry
 * at the path fails the call instead of being silently accepted, and a missing
 * parent fails too rather than conjuring a chain of folders the user never
 * asked for.
 */
export async function createLocalDirectory({
  cwd,
  path: rawPath,
}: CreateDirectoryParams): Promise<CreateEntryResult> {
  if (!rawPath) return { error: 'Path cannot be empty', path: '', success: false };

  const dirPath = resolveAgainstCwd(rawPath, cwd) ?? rawPath;

  try {
    await mkdir(dirPath, { recursive: false });
    return { path: dirPath, success: true };
  } catch (error) {
    return { error: describeCreateError(error, dirPath), path: dirPath, success: false };
  }
}
