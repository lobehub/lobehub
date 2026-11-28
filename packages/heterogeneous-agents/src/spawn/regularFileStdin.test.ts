import { existsSync, readSync, statSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRegularFileStdin } from './regularFileStdin';

const fsMocks = vi.hoisted(() => ({
  openImpl: undefined as ((filePath: string, flags: string) => Promise<any>) | undefined,
  writeFileImpl:
    undefined as
      | ((filePath: string, data: string, options: Record<string, unknown>) => Promise<void>)
      | undefined,
  writtenPaths: [] as string[],
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises');
  return {
    ...actual,
    open: (filePath: string, flags: string) =>
      (fsMocks.openImpl ?? (actual.open as any))(filePath, flags),
    writeFile: (filePath: string, data: string, options: Record<string, unknown>) => {
      fsMocks.writtenPaths.push(filePath);
      return (fsMocks.writeFileImpl ?? (actual.writeFile as any))(filePath, data, options);
    },
  };
});

/** The single path `createRegularFileStdin` asked to write in this test. */
const promptFilePath = () => {
  expect(fsMocks.writtenPaths).toHaveLength(1);
  return fsMocks.writtenPaths[0]!;
};

describe('createRegularFileStdin', () => {
  afterEach(() => {
    fsMocks.openImpl = undefined;
    fsMocks.writeFileImpl = undefined;
    fsMocks.writtenPaths = [];
    vi.restoreAllMocks();
  });

  it('hands over a 0600 prompt file under the temp dir and removes it on cleanup', async () => {
    const stdin = await createRegularFileStdin('hello doubao');

    try {
      const filePath = promptFilePath();
      expect(filePath.startsWith(tmpdir())).toBe(true);
      expect(statSync(filePath).mode & 0o777).toBe(0o600);

      // The handle exposes a raw fd, so read it through `readSync` with an
      // explicit position: `fsPromises.readFile` accepts a path, Buffer or URL
      // but not a file descriptor.
      const buffer = Buffer.alloc(64);
      const bytesRead = readSync(stdin.fd, buffer, 0, buffer.length, 0);
      expect(buffer.subarray(0, bytesRead).toString('utf8')).toBe('hello doubao');

      await stdin.cleanup();
      expect(existsSync(filePath)).toBe(false);
      // Cleanup is idempotent: a second call must not touch the closed fd.
      await expect(stdin.cleanup()).resolves.toBeUndefined();
    } finally {
      // Never leave the fd open if an assertion above fails: an unclosed
      // FileHandle is only reclaimed at GC time and emits a DEP0137 warning.
      await stdin.cleanup();
    }
  });

  it('removes the partially written file when the write rejects', async () => {
    fsMocks.writeFileImpl = async (filePath, _data, options) => {
      // A real `ENOSPC` still leaves the bytes written so far on disk.
      const actual = await vi.importActual<typeof fsPromises>('node:fs/promises');
      await actual.writeFile(filePath, 'partial secret', options as any);
      throw new Error('ENOSPC: no space left on device');
    };

    await expect(createRegularFileStdin('secret prompt')).rejects.toThrow('ENOSPC');
    expect(existsSync(promptFilePath())).toBe(false);
  });

  it('removes the written file when opening it for the child fails', async () => {
    fsMocks.openImpl = async () => {
      throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
    };

    await expect(createRegularFileStdin('secret prompt')).rejects.toThrow('EIO');
    expect(existsSync(promptFilePath())).toBe(false);
  });
});
