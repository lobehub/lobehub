import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { WriteFileParams, WriteFileResult } from '../types';
import { ensurePathWithin, resolveWithinRoot } from './containPath';
import { expandTilde } from './expandTilde';

export async function writeLocalFile({
  path: rawPath,
  content,
  workingDirectory,
}: WriteFileParams): Promise<WriteFileResult> {
  if (!rawPath) return { error: 'Path cannot be empty', success: false };
  if (content === undefined) return { error: 'Content cannot be empty', success: false };

  const filePath = resolveWithinRoot(expandTilde(rawPath) ?? rawPath, workingDirectory);

  const containment = await ensurePathWithin(filePath, workingDirectory);
  if (!containment.allowed) {
    return { error: containment.reason, success: false };
  }

  try {
    const dirname = path.dirname(filePath);
    await mkdir(dirname, { recursive: true });
    await writeFile(filePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    return { error: `Failed to write file: ${(error as Error).message}`, success: false };
  }
}
