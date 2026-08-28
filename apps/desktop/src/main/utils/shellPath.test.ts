import { execFile } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshShellPath } from './shellPath';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const execFileMock = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;

describe('refreshShellPath', () => {
  const originalPath = process.env.PATH;
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    process.env.PATH = '/usr/bin:/bin';
    process.env.SHELL = '/bin/zsh';
    execFileMock.mockReset();
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.SHELL = originalShell;
  });

  it('updates PATH from the login shell output', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(
        null,
        'shell startup output\n__LOBE_SHELL_PATH__/opt/homebrew/bin:/usr/bin__LOBE_SHELL_PATH__',
        '',
      );
    });

    await refreshShellPath();

    expect(process.env.PATH).toBe('/opt/homebrew/bin:/usr/bin');
    expect(execFileMock).toHaveBeenCalledWith(
      '/bin/zsh',
      expect.arrayContaining(['-ilc']),
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it('preserves PATH when the login shell returns no delimited value', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null, 'shell startup output only', '');
    });

    await refreshShellPath();

    expect(process.env.PATH).toBe('/usr/bin:/bin');
  });

  it('rejects without replacing PATH when shell startup fails', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(new Error('shell failed'), '', '');
    });

    await expect(refreshShellPath()).rejects.toThrow('shell failed');
    expect(process.env.PATH).toBe('/usr/bin:/bin');
  });
});
