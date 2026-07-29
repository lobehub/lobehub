import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fileSearchMock } = vi.hoisted(() => ({
  fileSearchMock: {
    glob: vi.fn(),
    search: vi.fn(),
  },
}));

vi.mock('@lobechat/local-file-shell', async () => {
  const actual = await vi.importActual<typeof import('@lobechat/local-file-shell')>(
    '@lobechat/local-file-shell',
  );

  return {
    ...actual,
    createFileSearchModule: vi.fn(() => fileSearchMock),
  };
});

describe('runLocalSystemTool file search routing', () => {
  beforeEach(() => {
    vi.resetModules();
    fileSearchMock.glob.mockReset();
    fileSearchMock.search.mockReset();
    fileSearchMock.glob.mockResolvedValue({
      files: ['/tmp/a.ts'],
      success: true,
      total_files: 1,
    });
    fileSearchMock.search.mockResolvedValue([
      {
        createdTime: new Date(),
        isDirectory: false,
        lastAccessTime: new Date(),
        modifiedTime: new Date(),
        name: 'a.ts',
        path: '/tmp/a.ts',
        size: 1,
        type: 'ts',
      },
    ]);
  });

  it('routes globFiles through the fallback factory with the default limit', async () => {
    const { runLocalSystemTool } = await import('./localSystemRuntime');

    await runLocalSystemTool('globFiles', { pattern: '**/*.ts', scope: '/tmp' });

    expect(fileSearchMock.glob).toHaveBeenCalledWith({
      limit: 100,
      pattern: '**/*.ts',
      scope: '/tmp',
    });
  });

  it('routes searchFiles through the fallback factory with an explicit limit', async () => {
    const { runLocalSystemTool } = await import('./localSystemRuntime');

    await runLocalSystemTool('searchFiles', {
      directory: '/tmp',
      keywords: 'a.ts',
      limit: 12,
    });

    expect(fileSearchMock.search).toHaveBeenCalledWith({
      directory: '/tmp',
      keywords: 'a.ts',
      limit: 12,
    });
  });

  it('routes searchFiles through the fallback factory with the default limit and resolved scope', async () => {
    const { runLocalSystemTool } = await import('./localSystemRuntime');

    await runLocalSystemTool('searchFiles', {
      directory: 'src',
      keywords: 'a.ts',
      scope: '/tmp',
    });

    expect(fileSearchMock.search).toHaveBeenCalledWith({
      directory: '/tmp/src',
      keywords: 'a.ts',
      limit: 100,
      scope: '/tmp',
    });
  });
});
