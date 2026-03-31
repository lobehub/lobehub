import fg from 'fast-glob';

import type { GlobFilesParams, GlobFilesResult } from '../types';

export async function globLocalFiles({ pattern, cwd }: GlobFilesParams): Promise<GlobFilesResult> {
  try {
    const files = await fg(pattern, {
      cwd: cwd || process.cwd(),
      dot: false,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });
    return { files };
  } catch (error) {
    return { error: (error as Error).message, files: [] };
  }
}
