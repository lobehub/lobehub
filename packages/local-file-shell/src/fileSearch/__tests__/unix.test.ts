import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolDetector } from '../../toolDetector';
import { LinuxSearchServiceImpl } from '../impl/linux';

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/Users/test-home'),
  platform: vi.fn().mockReturnValue('linux'),
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

const fgMock = vi.fn();
const fgStreamMock = () => (fgMock as unknown as { stream: ReturnType<typeof vi.fn> }).stream;
vi.mock('fast-glob', () => {
  const defaultExport = (...args: unknown[]) => fgMock(...args);
  Object.defineProperty(defaultExport, 'stream', { get: () => fgStreamMock() });
  return { default: defaultExport };
});

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
    (fgMock as unknown as { stream: ReturnType<typeof vi.fn> }).stream = vi.fn();
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

  it('uses fast-glob instead of find for globstar-compatible matching', async () => {
    const toolDetector: ToolDetector = {
      getBestTool: vi.fn().mockResolvedValue('find'),
    };
    const impl = new LinuxSearchServiceImpl(toolDetector);

    await impl.glob({ pattern: '**/*skill*', scope: '/repo/packages' });

    expect(fgMock).toHaveBeenCalledTimes(1);
    expect(execaMock).not.toHaveBeenCalledWith('find', expect.anything(), expect.anything());

    const [pattern, options] = fgMock.mock.calls[0] as [string, { cwd: string; ignore: string[] }];
    expect(pattern).toBe('**/*skill*');
    expect(options.cwd).toBe('/repo/packages');
    expect(options.ignore).toContain('**/node_modules/**');
    expect(options.ignore).toContain('**/.git/**');
  });

  it('passes the execution limit through to fd glob', async () => {
    const toolDetector: ToolDetector = {
      getBestTool: vi.fn().mockResolvedValue('fd'),
    };
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: '/repo/packages/a.ts\n/repo/packages/b.ts\n',
    });

    const impl = new LinuxSearchServiceImpl(toolDetector);
    await impl.glob({ limit: 7, pattern: '**/*.ts', scope: '/repo/packages' });

    expect(execaMock).toHaveBeenCalledWith(
      'fd',
      expect.arrayContaining(['--max-results', '7']),
      expect.anything(),
    );
  });

  it('does not force a glob execution limit when the caller omits it', async () => {
    const toolDetector: ToolDetector = {
      getBestTool: vi.fn().mockResolvedValue('fd'),
    };
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: '/repo/packages/a.ts\n',
    });

    const impl = new LinuxSearchServiceImpl(toolDetector);
    await impl.glob({ pattern: '**/*.ts', scope: '/repo/packages' });

    const [, args] = execaMock.mock.calls[0] as [string, string[]];
    expect(args).not.toContain('--max-results');
  });

  it('streams fast-glob results when the caller provides a glob limit', async () => {
    fgStreamMock().mockReturnValue(
      (async function* () {
        yield { path: '/repo/packages/b.ts', stats: { mtime: new Date('2026-01-02') } };
        yield { path: '/repo/packages/a.ts', stats: { mtime: new Date('2026-01-01') } };
        yield { path: '/repo/packages/c.ts', stats: { mtime: new Date('2026-01-03') } };
      })(),
    );

    const impl = new LinuxSearchServiceImpl();
    const result = await impl.glob({ limit: 2, pattern: '**/*.ts', scope: '/repo/packages' });

    expect(fgMock).not.toHaveBeenCalled();
    expect(fgStreamMock()).toHaveBeenCalledWith(
      '**/*.ts',
      expect.objectContaining({ cwd: '/repo/packages', stats: true }),
    );
    expect(result.files).toEqual(['/repo/packages/b.ts', '/repo/packages/a.ts']);
    expect(result.total_files).toBe(2);
  });
});
