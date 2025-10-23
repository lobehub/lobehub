import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import LocalFileCtr from '../LocalFileCtr';

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock file-loaders
vi.mock('@lobechat/file-loaders', () => ({
  SYSTEM_FILES_TO_IGNORE: ['.DS_Store', 'Thumbs.db'],
  loadFile: vi.fn(),
}));

// Mock electron
vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn(),
  },
}));

// Mock fast-glob
vi.mock('fast-glob', () => ({
  default: vi.fn(),
}));

// Mock node:fs/promises and node:fs
vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readdir: vi.fn(),
  rename: vi.fn(),
  access: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('node:fs', () => ({
  Stats: class Stats {},
  constants: {
    F_OK: 0,
  },
  stat: vi.fn(),
  readdir: vi.fn(),
  rename: vi.fn(),
  access: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
}));

// Mock FileSearchService
const mockSearchService = {
  search: vi.fn(),
};

// Mock makeSureDirExist
vi.mock('@/utils/file-system', () => ({
  makeSureDirExist: vi.fn(),
}));

const mockApp = {
  getService: vi.fn(() => mockSearchService),
} as unknown as App;

describe('LocalFileCtr', () => {
  let localFileCtr: LocalFileCtr;
  let mockShell: any;
  let mockFg: any;
  let mockLoadFile: any;
  let mockFsPromises: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import mocks
    mockShell = (await import('electron')).shell;
    mockFg = (await import('fast-glob')).default;
    mockLoadFile = (await import('@lobechat/file-loaders')).loadFile;
    mockFsPromises = await import('node:fs/promises');

    localFileCtr = new LocalFileCtr(mockApp);
  });

  describe('handleOpenLocalFile', () => {
    it('should open file successfully', async () => {
      vi.mocked(mockShell.openPath).mockResolvedValue('');

      const result = await localFileCtr.handleOpenLocalFile({ path: '/test/file.txt' });

      expect(result).toEqual({ success: true });
      expect(mockShell.openPath).toHaveBeenCalledWith('/test/file.txt');
    });

    it('should return error when opening file fails', async () => {
      const error = new Error('Failed to open');
      vi.mocked(mockShell.openPath).mockRejectedValue(error);

      const result = await localFileCtr.handleOpenLocalFile({ path: '/test/file.txt' });

      expect(result).toEqual({ success: false, error: 'Failed to open' });
    });
  });

  describe('handleOpenLocalFolder', () => {
    it('should open directory when isDirectory is true', async () => {
      vi.mocked(mockShell.openPath).mockResolvedValue('');

      const result = await localFileCtr.handleOpenLocalFolder({
        path: '/test/folder',
        isDirectory: true,
      });

      expect(result).toEqual({ success: true });
      expect(mockShell.openPath).toHaveBeenCalledWith('/test/folder');
    });

    it('should open parent directory when isDirectory is false', async () => {
      vi.mocked(mockShell.openPath).mockResolvedValue('');

      const result = await localFileCtr.handleOpenLocalFolder({
        path: '/test/folder/file.txt',
        isDirectory: false,
      });

      expect(result).toEqual({ success: true });
      expect(mockShell.openPath).toHaveBeenCalledWith('/test/folder');
    });

    it('should return error when opening folder fails', async () => {
      const error = new Error('Failed to open folder');
      vi.mocked(mockShell.openPath).mockRejectedValue(error);

      const result = await localFileCtr.handleOpenLocalFolder({
        path: '/test/folder',
        isDirectory: true,
      });

      expect(result).toEqual({ success: false, error: 'Failed to open folder' });
    });
  });

  describe('readFile', () => {
    it('should read file successfully with default location', async () => {
      const mockFileContent = 'line1\nline2\nline3\nline4\nline5';
      vi.mocked(mockLoadFile).mockResolvedValue({
        content: mockFileContent,
        filename: 'test.txt',
        fileType: 'txt',
        createdTime: new Date('2024-01-01'),
        modifiedTime: new Date('2024-01-02'),
      });

      const result = await localFileCtr.readFile({ path: '/test/file.txt' });

      expect(result.filename).toBe('test.txt');
      expect(result.fileType).toBe('txt');
      expect(result.totalLineCount).toBe(5);
      expect(result.content).toBe(mockFileContent);
    });

    it('should read file with custom location range', async () => {
      const mockFileContent = 'line1\nline2\nline3\nline4\nline5';
      vi.mocked(mockLoadFile).mockResolvedValue({
        content: mockFileContent,
        filename: 'test.txt',
        fileType: 'txt',
        createdTime: new Date('2024-01-01'),
        modifiedTime: new Date('2024-01-02'),
      });

      const result = await localFileCtr.readFile({ path: '/test/file.txt', loc: [1, 3] });

      expect(result.content).toBe('line2\nline3');
      expect(result.lineCount).toBe(2);
      expect(result.totalLineCount).toBe(5);
    });

    it('should handle file read error', async () => {
      vi.mocked(mockLoadFile).mockRejectedValue(new Error('File not found'));

      const result = await localFileCtr.readFile({ path: '/test/missing.txt' });

      expect(result.content).toContain('Error accessing or processing file');
      expect(result.lineCount).toBe(0);
      expect(result.charCount).toBe(0);
    });
  });

  describe('readFiles', () => {
    it('should read multiple files successfully', async () => {
      vi.mocked(mockLoadFile).mockResolvedValue({
        content: 'file content',
        filename: 'test.txt',
        fileType: 'txt',
        createdTime: new Date('2024-01-01'),
        modifiedTime: new Date('2024-01-02'),
      });

      const result = await localFileCtr.readFiles({
        paths: ['/test/file1.txt', '/test/file2.txt'],
      });

      expect(result).toHaveLength(2);
      expect(mockLoadFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleWriteFile', () => {
    it('should write file successfully', async () => {
      vi.mocked(mockFsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(mockFsPromises.writeFile).mockResolvedValue(undefined);

      const result = await localFileCtr.handleWriteFile({
        path: '/test/file.txt',
        content: 'test content',
      });

      expect(result).toEqual({ success: true });
    });

    it('should return error when path is empty', async () => {
      const result = await localFileCtr.handleWriteFile({
        path: '',
        content: 'test content',
      });

      expect(result).toEqual({ success: false, error: 'Path cannot be empty' });
    });

    it('should return error when content is undefined', async () => {
      const result = await localFileCtr.handleWriteFile({
        path: '/test/file.txt',
        content: undefined as any,
      });

      expect(result).toEqual({ success: false, error: 'Content cannot be empty' });
    });

    it('should handle write error', async () => {
      vi.mocked(mockFsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(mockFsPromises.writeFile).mockRejectedValue(new Error('Write failed'));

      const result = await localFileCtr.handleWriteFile({
        path: '/test/file.txt',
        content: 'test content',
      });

      expect(result).toEqual({ success: false, error: 'Failed to write file: Write failed' });
    });
  });

  describe('handleRenameFile', () => {
    it('should rename file successfully', async () => {
      vi.mocked(mockFsPromises.rename).mockResolvedValue(undefined);

      const result = await localFileCtr.handleRenameFile({
        path: '/test/old.txt',
        newName: 'new.txt',
      });

      expect(result).toEqual({ success: true, newPath: '/test/new.txt' });
      expect(mockFsPromises.rename).toHaveBeenCalledWith('/test/old.txt', '/test/new.txt');
    });

    it('should skip rename when paths are identical', async () => {
      const result = await localFileCtr.handleRenameFile({
        path: '/test/file.txt',
        newName: 'file.txt',
      });

      expect(result).toEqual({ success: true, newPath: '/test/file.txt' });
      expect(mockFsPromises.rename).not.toHaveBeenCalled();
    });

    it('should reject invalid new name with path separators', async () => {
      const result = await localFileCtr.handleRenameFile({
        path: '/test/old.txt',
        newName: '../new.txt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid new name');
    });

    it('should reject invalid new name with special characters', async () => {
      const result = await localFileCtr.handleRenameFile({
        path: '/test/old.txt',
        newName: 'new:file.txt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid new name');
    });

    it('should handle file not found error', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      vi.mocked(mockFsPromises.rename).mockRejectedValue(error);

      const result = await localFileCtr.handleRenameFile({
        path: '/test/old.txt',
        newName: 'new.txt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('File or directory not found');
    });

    it('should handle file already exists error', async () => {
      const error: any = new Error('File exists');
      error.code = 'EEXIST';
      vi.mocked(mockFsPromises.rename).mockRejectedValue(error);

      const result = await localFileCtr.handleRenameFile({
        path: '/test/old.txt',
        newName: 'new.txt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('handleLocalFilesSearch', () => {
    it('should search files successfully', async () => {
      const mockResults = [
        {
          name: 'test.txt',
          path: '/test/test.txt',
          isDirectory: false,
          size: 100,
          type: 'txt',
        },
      ];
      mockSearchService.search.mockResolvedValue(mockResults);

      const result = await localFileCtr.handleLocalFilesSearch({ keywords: 'test' });

      expect(result).toEqual(mockResults);
      expect(mockSearchService.search).toHaveBeenCalledWith('test', { limit: 30 });
    });

    it('should return empty array on search error', async () => {
      mockSearchService.search.mockRejectedValue(new Error('Search failed'));

      const result = await localFileCtr.handleLocalFilesSearch({ keywords: 'test' });

      expect(result).toEqual([]);
    });
  });

  describe('handleGlobFiles', () => {
    it('should glob files successfully', async () => {
      const mockFiles = [
        { path: '/test/file1.txt', stats: { mtime: new Date('2024-01-02') } },
        { path: '/test/file2.txt', stats: { mtime: new Date('2024-01-01') } },
      ];
      vi.mocked(mockFg).mockResolvedValue(mockFiles);

      const result = await localFileCtr.handleGlobFiles({
        pattern: '*.txt',
        path: '/test',
      });

      expect(result.success).toBe(true);
      expect(result.files).toEqual(['/test/file1.txt', '/test/file2.txt']);
      expect(result.total_files).toBe(2);
    });

    it('should handle glob error', async () => {
      vi.mocked(mockFg).mockRejectedValue(new Error('Glob failed'));

      const result = await localFileCtr.handleGlobFiles({
        pattern: '*.txt',
      });

      expect(result).toEqual({
        success: false,
        files: [],
        total_files: 0,
      });
    });
  });
});
