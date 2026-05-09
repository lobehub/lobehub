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

  describe('globFiles', () => {
    it('should preserve scope and relative pattern when delegating glob search', async () => {
      globFilesMock.mockResolvedValue({
        files: ['/tmp/images/a.png'],
        success: true,
        total_files: 1,
      });

      await localSystemExecutor.globFiles({
        pattern: '**/*.{png,jpg,jpeg,gif,webp}',
        scope: '/tmp/images',
      });

      expect(globFilesMock).toHaveBeenCalledWith({
        pattern: '**/*.{png,jpg,jpeg,gif,webp}',
        scope: '/tmp/images',
      });
    });

    it('returns formatted "Found N files" content on success', async () => {
      globFilesMock.mockResolvedValue({
        engine: 'fast-glob',
        files: ['/Users/me/Downloads/a.pdf', '/Users/me/Downloads/b.pdf'],
        success: true,
        total_files: 2,
      });

      const result = await localSystemExecutor.globFiles({
        pattern: '**/*.pdf',
        scope: '/Users/me/Downloads',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Found 2 files');
      expect(result.state).toEqual({
        files: ['/Users/me/Downloads/a.pdf', '/Users/me/Downloads/b.pdf'],
        pattern: '**/*.pdf',
        totalCount: 2,
      });
    });

    it('falls back to a meaningful content + preserves state when IPC reports failure with no error message', async () => {
      // Defense in depth: even if normalizeResult ever forgets to forward
      // `raw.error`, toResult should still produce a non-empty content
      // ("Tool execution failed") so the Response panel and the LLM never see
      // an empty string. State must also survive into the failure result so
      // any renderer can still draw partial output.
      globFilesMock.mockResolvedValue({
        engine: 'fast-glob',
        files: [],
        success: false,
        total_files: 0,
      });

      const result = await localSystemExecutor.globFiles({
        pattern: '**/*never-matches*',
      });

      expect(result.content).toBeTruthy();
      expect(result.content).not.toBe('');
      expect(result.state).toEqual({
        files: [],
        pattern: '**/*never-matches*',
        totalCount: 0,
      });
    });

    it('surfaces the underlying error in content when the IPC reports failure', async () => {
      // Regression: a fast-glob throw used to come back as
      //   { result: {files:[], totalCount:0}, success: false }
      // with the error stripped. ComputerRuntime.errorOutput then did
      // `JSON.stringify(undefined)` and produced `content: undefined`,
      // which the chat store coerced to "" — leaving Glob tool messages
      // with state set but Response panel blank. Verify we now keep the
      // error message all the way into `content`.
      globFilesMock.mockResolvedValue({
        engine: 'fast-glob',
        error: "EACCES: permission denied, scandir '/System/Volumes/Data'",
        files: [],
        success: false,
        total_files: 0,
      });

      const result = await localSystemExecutor.globFiles({
        pattern: '**/*Financial*Statement*',
      });

      expect(result.success).toBe(true);
      expect(result.content).toBeTruthy();
      expect(result.content).toContain('EACCES');
      expect(result.state).toEqual({
        files: [],
        pattern: '**/*Financial*Statement*',
        totalCount: 0,
      });
    });
  });
});
