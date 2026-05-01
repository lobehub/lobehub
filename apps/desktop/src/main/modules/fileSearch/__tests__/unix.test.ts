import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LinuxSearchServiceImpl } from '../impl/linux';

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/Users/test-home'),
  platform: vi.fn().mockReturnValue('linux'),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

const fgMock = vi.fn();
vi.mock('fast-glob', () => ({
  default: (...args: unknown[]) => fgMock(...args),
}));

const execaMock = vi.fn();
vi.mock('execa', () => ({
  execa: (...args: unknown[]) => execaMock(...args),
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({
    atime: new Date(),
    birthtime: new Date(),
    isDirectory: () => false,
    mtime: new Date(),
    size: 0,
  }),
}));

describe('UnixFileSearch glob fallback root', () => {
  beforeEach(() => {
    fgMock.mockReset();
    execaMock.mockReset();
    // Force the Unix tool selection to fall through to fast-glob so we
    // don't have to mock fd/find availability checks.
    execaMock.mockRejectedValue(new Error('command not found'));
    fgMock.mockResolvedValue([]);
  });

  it('runs glob inside the user home directory when no scope is provided', async () => {
    // Regression: previously fell back to process.cwd(), which inside a
    // packaged Electron app is the bundle path — making `**/*foo*` searches
    // effectively look at nothing user-visible.
    const impl = new LinuxSearchServiceImpl();
    await impl.glob({ pattern: '**/*report*' });

    expect(fgMock).toHaveBeenCalledTimes(1);
    const [pattern, options] = fgMock.mock.calls[0] as [string, { cwd: string }];
    expect(pattern).toBe('**/*report*');
    expect(options.cwd).toBe('/Users/test-home');
  });

  it('honors an explicit scope over the home-directory fallback', async () => {
    const impl = new LinuxSearchServiceImpl();
    await impl.glob({ pattern: '**/*.ts', scope: '/Users/test-home/Downloads' });

    const [, options] = fgMock.mock.calls[0] as [string, { cwd: string }];
    expect(options.cwd).toBe('/Users/test-home/Downloads');
  });
});
