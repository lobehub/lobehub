import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { withFileLock } from './atomicWrite';

let directory: string;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('file locking through symlink aliases', () => {
  it.skipIf(process.platform === 'win32')(
    'serializes a target and its symlink as the same file',
    async () => {
      directory = await mkdtemp(path.join(tmpdir(), 'file-alias-lock-'));
      const target = path.join(directory, 'target.txt');
      const alias = path.join(directory, 'alias.txt');
      await writeFile(target, 'content');
      await symlink(target, alias);
      const order: string[] = [];
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const firstStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const first = withFileLock(target, async () => {
        order.push('first started');
        started();
        await gate;
        order.push('first finished');
      });
      await firstStarted;
      const second = withFileLock(alias, async () => {
        order.push('alias');
      });
      await new Promise<void>((resolve) =>
        setImmediate(() => {
          release();
          resolve();
        }),
      );
      await Promise.all([first, second]);
      expect(order).toEqual(['first started', 'first finished', 'alias']);
    },
  );
});
