import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, it, vi } from 'vitest';

import { watchServerI18n } from './prepare';

const { watchers } = vi.hoisted(() => ({
  watchers: new Map<string, (event: string, filename: string) => void>(),
}));

vi.mock('node:fs', () => ({
  watch: vi.fn(
    (directory: string, _options: unknown, listener: (event: string, filename: string) => void) => {
      watchers.set(directory, listener);
      return { close: vi.fn() };
    },
  ),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, output: { stdout: string }) => void,
    ) => callback(null, { stdout: '' }),
  ),
}));

it('regenerates with the wrapper config after an embedded repository source changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'server-i18n-watch-'));
  const sourceRoot = path.join(root, 'upstream');
  let stop: (() => void) | undefined;
  try {
    // Wrappers can omit directories supplied by the embedded repository.
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'apps/server'), { recursive: true });
    stop = await watchServerI18n(root, sourceRoot);
    const listener = watchers.get(await realpath(path.join(sourceRoot, 'apps/server')));
    expect(listener).toBeDefined();
    listener?.('change', 'translation.ts');
    await vi.waitFor(() =>
      expect(execFile).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining(['--max-old-space-size=6144', '--import', 'tsx']),
        expect.objectContaining({ cwd: root }),
        expect.any(Function),
      ),
    );
  } finally {
    stop?.();
    await rm(root, { recursive: true, force: true });
  }
});
