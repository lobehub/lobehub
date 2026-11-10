import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { uiBuildStale } from './uiBuild';

let root: string;

const touch = async (file: string, seconds: number) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '');
  await utimes(file, seconds, seconds);
};

afterEach(async () => {
  if (root) await rm(root, { force: true, recursive: true });
});

describe('uiBuildStale', () => {
  it('rebuilds when there is no build yet', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ui-build-'));
    await touch(path.join(root, 'src/report/ui/App.tsx'), 100);
    expect(await uiBuildStale(path.join(root, 'ui/dist'), [path.join(root, 'src')])).toBe(true);
  });

  it('rebuilds when a source file is newer than the build', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ui-build-'));
    await touch(path.join(root, 'ui/dist/index.html'), 100);
    await touch(path.join(root, 'src/report/ui/nested/Review.tsx'), 200);
    expect(await uiBuildStale(path.join(root, 'ui/dist'), [path.join(root, 'src')])).toBe(true);
  });

  it('keeps a build that is newer than every source file', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ui-build-'));
    await touch(path.join(root, 'src/report/ui/App.tsx'), 100);
    await touch(path.join(root, 'report.vite.config.ts'), 100);
    await touch(path.join(root, 'ui/dist/index.html'), 200);
    expect(
      await uiBuildStale(path.join(root, 'ui/dist'), [
        path.join(root, 'src'),
        path.join(root, 'report.vite.config.ts'),
      ]),
    ).toBe(false);
  });
});
