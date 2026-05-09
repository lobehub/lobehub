import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getProjectFileIndexMock } = vi.hoisted(() => ({
  getProjectFileIndexMock: vi.fn(),
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: {
    getProjectFileIndex: getProjectFileIndexMock,
  },
}));

describe('localFileMentionIndex', () => {
  beforeEach(() => {
    vi.resetModules();
    getProjectFileIndexMock.mockReset();
  });

  it('should reuse the project file index across keyword searches', async () => {
    getProjectFileIndexMock.mockResolvedValue({
      entries: [
        {
          isDirectory: false,
          name: 'index.ts',
          path: '/workspace/project/src/index.ts',
          relativePath: 'src/index.ts',
        },
        {
          isDirectory: false,
          name: 'Button.tsx',
          path: '/workspace/project/src/components/Button.tsx',
          relativePath: 'src/components/Button.tsx',
        },
      ],
      indexedAt: '2026-04-28T00:00:00.000Z',
      root: '/workspace/project',
      source: 'git',
      totalCount: 2,
    });

    const { searchProjectFileMentionIndex } = await import('./localFileMentionIndex');

    await searchProjectFileMentionIndex('/workspace/project', 'src', 20);
    const secondResult = await searchProjectFileMentionIndex('/workspace/project', 'button', 20);

    expect(getProjectFileIndexMock).toHaveBeenCalledTimes(1);
    expect(secondResult).toEqual([
      expect.objectContaining({
        path: '/workspace/project/src/components/Button.tsx',
      }),
    ]);
  });
});
