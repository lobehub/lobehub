import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { describeDeviceHost } from '../deviceHost';
import type { WriteFileParams, WriteFileResult } from '../types';
import { verifyWrittenContent, withFileLock, writeFileAtomic } from './atomicWrite';
import { resolveAgainstCwd } from './expandTilde';

const PATH_ACCESS_CODES = new Set(['EACCES', 'ENOENT', 'ENOTDIR', 'EPERM']);

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
      await writeFileAtomic(filePath, content);

      const writeError = await verifyWrittenContent(filePath, content);
      if (writeError) return { error: writeError, success: false };

      return { success: true };
    } catch (error) {
      const { code, message } = error as NodeJS.ErrnoException;
      // Name the host and OS account on path-access failures so the model can
      // tell an ordinary bad path from a device now running under another host
      // or account (every path from the earlier account fails at once).
      const where =
        code && PATH_ACCESS_CODES.has(code)
          ? `. This device is running on ${describeDeviceHost()}.`
          : '';
      return { error: `Failed to write file: ${message}${where}`, success: false };
    }
  });
}
