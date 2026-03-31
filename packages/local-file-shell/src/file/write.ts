import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { WriteFileParams, WriteFileResult } from '../types';

export async function writeLocalFile({
  path: filePath,
  content,
}: WriteFileParams): Promise<WriteFileResult> {
  if (!filePath) return { error: 'Path cannot be empty', success: false };
  if (content === undefined) return { error: 'Content cannot be empty', success: false };

  try {
    const dirname = path.dirname(filePath);
    await mkdir(dirname, { recursive: true });
    await writeFile(filePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    return { error: `Failed to write file: ${(error as Error).message}`, success: false };
  }
}
