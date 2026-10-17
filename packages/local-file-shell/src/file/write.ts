import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { detectTextFileFormat } from '@lobechat/file-loaders/utils/decodeTextFile';

import type { WriteFileParams, WriteFileResult } from '../types';
import { verifyWrittenContent, withFileLock, writeFileAtomic } from './atomicWrite';
import { resolveAgainstCwd } from './expandTilde';

export async function writeLocalFile({
  path: rawPath,
  content,
  cwd,
}: WriteFileParams): Promise<WriteFileResult> {
  if (!rawPath) return { error: 'Path cannot be empty', success: false };
  if (content === undefined) return { error: 'Content cannot be empty', success: false };

  const filePath = resolveAgainstCwd(rawPath, cwd) ?? rawPath;

  // Shares the per-path queue with editLocalFile, so a write and an edit to the
  // same file in one batch cannot interleave.
  return withFileLock(filePath, async () => {
    try {
      const dirname = path.dirname(filePath);
      await mkdir(dirname, { recursive: true });
      // Overwriting an existing file keeps its encoding and BOM, so a UTF-16
      // file updated via writeFile does not silently become UTF-8; new files
      // default to UTF-8 without a BOM.
      const format = await detectTextFileFormat(filePath).catch(
        () => ({ bom: null, encoding: 'utf8' }) as const,
      );
      await writeFileAtomic(filePath, content, format);

      const writeError = await verifyWrittenContent(filePath, content);
      if (writeError) return { error: writeError, success: false };

      return { success: true };
    } catch (error) {
      return { error: `Failed to write file: ${(error as Error).message}`, success: false };
    }
  });
}
