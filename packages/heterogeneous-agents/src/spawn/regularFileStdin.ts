import { open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface RegularFileStdin {
  /** Release the fd and delete the temp file. Safe to call more than once. */
  cleanup: () => Promise<void>;
  /** Read-only fd to hand a child as its stdio[0]. */
  fd: number;
}

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
  await writeFile(filePath, payload, { encoding: 'utf8', mode: 0o600 });
  const handle = await open(filePath, 'r');

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
