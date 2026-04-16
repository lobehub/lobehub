import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localSystemExecutor } from './index';

const { globFilesMock } = vi.hoisted(() => ({
  globFilesMock: vi.fn(),
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: {
    globFiles: globFilesMock,
  },
}));

describe('LocalSystemExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('globLocalFiles', () => {
    it('should preserve scope and relative pattern when delegating glob search', async () => {
      globFilesMock.mockResolvedValue({
        files: ['/tmp/images/a.png'],
        success: true,
        total_files: 1,
      });

      await localSystemExecutor.globLocalFiles({
        pattern: '**/*.{png,jpg,jpeg,gif,webp}',
        scope: '/tmp/images',
      });

      expect(globFilesMock).toHaveBeenCalledWith({
        pattern: '**/*.{png,jpg,jpeg,gif,webp}',
        scope: '/tmp/images',
      });
    });
  });
});
