import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchProjectFilesMock } = vi.hoisted(() => ({
  searchProjectFilesMock: vi.fn(),
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: {
    searchProjectFiles: searchProjectFilesMock,
  },
}));

describe('localFileMentionIndex', () => {
  beforeEach(() => {
    searchProjectFilesMock.mockReset();
  });

  it('searches project files through the host-side search service', async () => {
    searchProjectFilesMock.mockResolvedValue({
      entries: [
        {
          isDirectory: true,
          name: 'components',
          path: '/workspace/project/src/components',
          relativePath: 'src/components/',
        },
        {
          isDirectory: false,
          name: 'Button.tsx',
          path: '/workspace/project/src/components/Button.tsx',
          relativePath: 'src/components/Button.tsx',
        },
      ],
      root: '/workspace/project',
      searchedAt: '2026-04-28T00:00:00.000Z',
      source: 'git',
    });

    const { searchProjectFileMentionIndex } = await import('./localFileMentionIndex');

    const result = await searchProjectFileMentionIndex(
      '/workspace/project',
      'button',
      20,
      'device-1',
    );

    expect(searchProjectFilesMock).toHaveBeenCalledWith({
      deviceId: 'device-1',
      limit: 20,
      query: 'button',
      scope: '/workspace/project',
    });
    expect(result).toEqual([
      expect.objectContaining({
        path: '/workspace/project/src/components/Button.tsx',
      }),
    ]);
  });
});
