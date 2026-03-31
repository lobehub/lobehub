import { mkdirSync, statSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeSureDirExist } from '../file-system';

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
}));

describe('file-system', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('makeSureDirExist', () => {
    it('should not create directory if it already exists', () => {
      const dir = '/test/path';
      vi.mocked(statSync).mockReturnValue({} as any);

      makeSureDirExist(dir);

      expect(statSync).toHaveBeenCalledWith(dir);
      expect(mkdirSync).not.toHaveBeenCalled();
    });

    it('should create directory if it does not exist', () => {
      const dir = '/test/new-path';
      vi.mocked(statSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      makeSureDirExist(dir);

      expect(statSync).toHaveBeenCalledWith(dir);
      expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
    });

    it('should create directory recursively', () => {
      const dir = '/test/deeply/nested/path';
      vi.mocked(statSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      makeSureDirExist(dir);

      expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
    });

    it('should throw error if mkdir fails due to permission issues', () => {
      const dir = '/test/permission-denied';
      vi.mocked(statSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });
      vi.mocked(mkdirSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => makeSureDirExist(dir)).toThrowError(
        `Could not create target directory: ${dir}. Error: EACCES: permission denied`,
      );
    });

    it('should throw error if mkdir fails with custom error message', () => {
      const dir = '/test/custom-error';
      const customError = new Error('Custom mkdir error');
      vi.mocked(statSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });
      vi.mocked(mkdirSync).mockImplementation(() => {
        throw customError;
      });

      expect(() => makeSureDirExist(dir)).toThrowError(
        `Could not create target directory: ${dir}. Error: Custom mkdir error`,
      );
    });

    it('should handle empty directory path', () => {
      const dir = '';
      vi.mocked(statSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });
      vi.mocked(mkdirSync).mockImplementation(() => undefined);

      makeSureDirExist(dir);

      expect(mkdirSync).toHaveBeenCalledWith('', { recursive: true });
    });
  });
});
