import { type FileHandle, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface RegularFileStdin {
  /** Release the fd and delete the temp file. Safe to call more than once. */
  cleanup: () => Promise<void>;
  /** Read-only fd to hand a child as its stdio[0]. */
  fd: number;
}

/**
 * Create the prompt file and open it for the child.
 *
 * The caller only ever learns the pathname through the returned handle, so a
 * `writeFile` that rejects halfway (e.g. `ENOSPC`) or an `open` that fails
 * would strand the prompt — content that can be sensitive — in the OS temp
 * directory with nobody left to delete it. Unlink at every failure point and
 * rethrow the original error.
 */
const writePromptFile = async (filePath: string, payload: string): Promise<FileHandle> => {
  try {
    await writeFile(filePath, payload, { encoding: 'utf8', mode: 0o600 });
    return await open(filePath, 'r');
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
};

/**
 * Hand a child process its prompt through a regular file instead of the
 * socketpair Node installs for `stdio: 'pipe'`.
 *
 * Doubao inspects fd 0's file type and accepts only a terminal, a FIFO or a
 * regular file. libuv backs non-blocking pipes with `socketpair(2)`, so the
 * default `'pipe'` makes the CLI exit before running anything with
 * `stdin must be a terminal, pipe or regular file`. Writing the payload to a
 * 0600 temp file keeps the prompt out of argv and hands over a real file.
 */
export const createRegularFileStdin = async (payload: string): Promise<RegularFileStdin> => {
  const filePath = path.join(
    tmpdir(),
    `lh-agent-stdin-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const handle = await writePromptFile(filePath, payload);

  let closed = false;

  return {
    cleanup: async () => {
      if (closed) return;
      closed = true;
      await handle.close().catch(() => {});
      await rm(filePath, { force: true }).catch(() => {});
    },
    fd: handle.fd,
  };
};
