import { lstat, mkdtemp, readlink, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { moveLocalFiles } from './move';

let directory: string;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('moving dangling symbolic links', () => {
  it.skipIf(process.platform === 'win32')(
    'moves the link even when its target is absent',
    async () => {
      directory = await mkdtemp(path.join(tmpdir(), 'move-link-'));
      const source = path.join(directory, 'source');
      const target = path.join(directory, 'moved');
      await symlink('missing-target', source);
      const [result] = await moveLocalFiles({ items: [{ oldPath: source, newPath: target }] });
      expect(result.success).toBe(true);
      expect((await lstat(target)).isSymbolicLink()).toBe(true);
      expect(await readlink(target)).toBe('missing-target');
      await expect(lstat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
