import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import LocalFileCtr from '../LocalFileCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

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
  ipcMain: {
    handle: ipcMainHandleMock,
  },
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

    it('should read full file content when fullContent is true', async () => {
      const mockFileContent = 'line1\nline2\nline3\nline4\nline5';
      vi.mocked(mockLoadFile).mockResolvedValue({
        content: mockFileContent,
        filename: 'test.txt',
        fileType: 'txt',
        createdTime: new Date('2024-01-01'),
        modifiedTime: new Date('2024-01-02'),
      });

      const result = await localFileCtr.readFile({ path: '/test/file.txt', fullContent: true });

      expect(result.content).toBe(mockFileContent);
      expect(result.lineCount).toBe(5);
      expect(result.charCount).toBe(mockFileContent.length);
      expect(result.totalLineCount).toBe(5);
      expect(result.totalCharCount).toBe(mockFileContent.length);
      expect(result.loc).toEqual([0, 5]);
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
      expect(mockSearchService.search).toHaveBeenCalledWith('test', {
        keywords: 'test',
        limit: 30,
      });
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

  describe('handleEditFile', () => {
    it('should replace first occurrence successfully', async () => {
      const originalContent = 'Hello world\nHello again\nGoodbye world';
      vi.mocked(mockFsPromises.readFile).mockResolvedValue(originalContent);
      vi.mocked(mockFsPromises.writeFile).mockResolvedValue(undefined);

      const result = await localFileCtr.handleEditFile({
        file_path: '/test/file.txt',
        old_string: 'Hello',
        new_string: 'Hi',
        replace_all: false,
      });

      expect(result.success).toBe(true);
      expect(result.replacements).toBe(1);
      expect(result.linesAdded).toBe(1);
      expect(result.linesDeleted).toBe(1);
      expect(result.diffText).toContain('diff --git a/test/file.txt b/test/file.txt');
      expect(mockFsPromises.writeFile).toHaveBeenCalledWith(
        '/test/file.txt',
        'Hi world\nHello again\nGoodbye world',
        'utf8',
      );
    });

    it('should replace all occurrences when replace_all is true', async () => {
      const originalContent = 'Hello world\nHello again\nHello there';
      vi.mocked(mockFsPromises.readFile).mockResolvedValue(originalContent);
      vi.mocked(mockFsPromises.writeFile).mockResolvedValue(undefined);

      const result = await localFileCtr.handleEditFile({
        file_path: '/test/file.txt',
        old_string: 'Hello',
        new_string: 'Hi',
        replace_all: true,
      });

      expect(result.success).toBe(true);
      expect(result.replacements).toBe(3);
      expect(result.linesAdded).toBe(3);
      expect(result.linesDeleted).toBe(3);
      expect(mockFsPromises.writeFile).toHaveBeenCalledWith(
        '/test/file.txt',
        'Hi world\nHi again\nHi there',
        'utf8',
      );
    });

    it('should handle multiline replacement correctly', async () => {
      const originalContent = 'function test() {\n  console.log("old");\n}';
      vi.mocked(mockFsPromises.readFile).mockResolvedValue(originalContent);
      vi.mocked(mockFsPromises.writeFile).mockResolvedValue(undefined);

      const result = await localFileCtr.handleEditFile({
        file_path: '/test/file.js',
        old_string: 'console.log("old");',
        new_string: 'console.log("new");\n  console.log("added");',
        replace_all: false,
      });

      expect(result.success).toBe(true);
      expect(result.replacements).toBe(1);
      expect(result.linesAdded).toBe(2);
      expect(result.linesDeleted).toBe(1);
    });

    it('should return error when old_string is not found', async () => {
      const originalContent = 'Hello world';
      vi.mocked(mockFsPromises.readFile).mockResolvedValue(originalContent);

      const result = await localFileCtr.handleEditFile({
        file_path: '/test/file.txt',
        old_string: 'NonExistent',
        new_string: 'New',
        replace_all: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('The specified old_string was not found in the file');
      expect(result.replacements).toBe(0);
      expect(mockFsPromises.writeFile).not.toHaveBeenCalled();
    });

    it('should handle file read error', async () => {
      vi.mocked(mockFsPromises.readFile).mockRejectedValue(new Error('Permission denied'));

      const result = await localFileCtr.handleEditFile({
        file_path: '/test/file.txt',
        old_string: 'Hello',
        new_string: 'Hi',
        replace_all: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
      expect(result.replacements).toBe(0);
    });

    it('should handle file write error', async () => {
      const originalContent = 'Hello world';
      vi.mocked(mockFsPromises.readFile).mockResolvedValue(originalContent);
      vi.mocked(mockFsPromises.writeFile).mockRejectedValue(new Error('Disk full'));

      const result = await localFileCtr.handleEditFile({
        file_path: '/test/file.txt',
        old_string: 'Hello',
        new_string: 'Hi',
        replace_all: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Disk full');
    });

    it('should generate correct diff format', async () => {
      const originalContent = 'line 1\nline 2\nline 3';
      vi.mocked(mockFsPromises.readFile).mockResolvedValue(originalContent);
      vi.mocked(mockFsPromises.writeFile).mockResolvedValue(undefined);

      const result = await localFileCtr.handleEditFile({
        file_path: '/test/file.txt',
        old_string: 'line 2',
        new_string: 'modified line 2',
        replace_all: false,
      });

      expect(result.success).toBe(true);
      expect(result.diffText).toContain('diff --git a/test/file.txt b/test/file.txt');
      expect(result.diffText).toContain('-line 2');
      expect(result.diffText).toContain('+modified line 2');
    });
  });

  describe('handleGrepContent', () => {
    it('should search content in a single file', async () => {
      vi.mocked(mockFsPromises.stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
      } as any);
      vi.mocked(mockFsPromises.readFile).mockResolvedValue('Hello world\nTest line\nAnother test');

      const result = await localFileCtr.handleGrepContent({
        'pattern': 'test',
        'path': '/test/file.txt',
        '-i': true,
      });

      expect(result.success).toBe(true);
      expect(result.matches).toContain('/test/file.txt');
      expect(result.total_matches).toBe(1);
    });

    it('should search content in directory with default glob pattern', async () => {
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        if (filePath === '/test') {
          return { isFile: () => false, isDirectory: () => true } as any;
        }
        return { isFile: () => true, isDirectory: () => false } as any;
      });
      vi.mocked(mockFg).mockResolvedValue(['/test/file1.txt', '/test/file2.txt']);
      vi.mocked(mockFsPromises.readFile).mockImplementation(async (filePath) => {
        if (filePath === '/test/file1.txt') return 'Hello world';
        if (filePath === '/test/file2.txt') return 'Test content';
        return '';
      });

      const result = await localFileCtr.handleGrepContent({
        pattern: 'Hello',
        path: '/test',
      });

      expect(result.success).toBe(true);
      expect(result.matches).toContain('/test/file1.txt');
      expect(result.total_matches).toBe(1);
      expect(mockFg).toHaveBeenCalledWith('**/*', expect.objectContaining({ cwd: '/test' }));
    });

    it('should auto-prefix glob pattern with **/ for non-recursive patterns', async () => {
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        if (filePath === '/test') {
          return { isFile: () => false, isDirectory: () => true } as any;
        }
        return { isFile: () => true, isDirectory: () => false } as any;
      });
      vi.mocked(mockFg).mockResolvedValue(['/test/src/file1.ts', '/test/lib/file2.tsx']);
      vi.mocked(mockFsPromises.readFile).mockResolvedValue('const test = "hello";');

      const result = await localFileCtr.handleGrepContent({
        pattern: 'test',
        path: '/test',
        glob: '*.{ts,tsx}',
      });

      expect(result.success).toBe(true);
      // Should auto-prefix *.{ts,tsx} with **/ to make it recursive
      expect(mockFg).toHaveBeenCalledWith(
        '**/*.{ts,tsx}',
        expect.objectContaining({ cwd: '/test' }),
      );
    });

    it('should not modify glob pattern that already contains path separator', async () => {
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        if (filePath === '/test') {
          return { isFile: () => false, isDirectory: () => true } as any;
        }
        return { isFile: () => true, isDirectory: () => false } as any;
      });
      vi.mocked(mockFg).mockResolvedValue(['/test/src/file1.ts']);
      vi.mocked(mockFsPromises.readFile).mockResolvedValue('const test = "hello";');

      const result = await localFileCtr.handleGrepContent({
        pattern: 'test',
        path: '/test',
        glob: 'src/*.ts',
      });

      expect(result.success).toBe(true);
      // Should not modify glob pattern that already contains /
      expect(mockFg).toHaveBeenCalledWith('src/*.ts', expect.objectContaining({ cwd: '/test' }));
    });

    it('should not modify glob pattern that starts with **', async () => {
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        if (filePath === '/test') {
          return { isFile: () => false, isDirectory: () => true } as any;
        }
        return { isFile: () => true, isDirectory: () => false } as any;
      });
      vi.mocked(mockFg).mockResolvedValue(['/test/src/file1.ts']);
      vi.mocked(mockFsPromises.readFile).mockResolvedValue('const test = "hello";');

      const result = await localFileCtr.handleGrepContent({
        pattern: 'test',
        path: '/test',
        glob: '**/components/*.tsx',
      });

      expect(result.success).toBe(true);
      // Should not modify glob pattern that already starts with **
      expect(mockFg).toHaveBeenCalledWith(
        '**/components/*.tsx',
        expect.objectContaining({ cwd: '/test' }),
      );
    });

    it('should filter by type when provided', async () => {
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        if (filePath === '/test') {
          return { isFile: () => false, isDirectory: () => true } as any;
        }
        return { isFile: () => true, isDirectory: () => false } as any;
      });
      // fast-glob returns all files, then type filter is applied
      vi.mocked(mockFg).mockResolvedValue(['/test/file1.ts', '/test/file2.js', '/test/file3.ts']);
      vi.mocked(mockFsPromises.readFile).mockResolvedValue('unique_pattern');

      const result = await localFileCtr.handleGrepContent({
        pattern: 'unique_pattern',
        path: '/test',
        type: 'ts',
      });

      expect(result.success).toBe(true);
      // Type filter should exclude .js files from being searched
      // Only .ts files should be in the results
      expect(result.matches).not.toContain('/test/file2.js');
      // At least one .ts file should match
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches.every((m) => m.endsWith('.ts'))).toBe(true);
    });

    it('should return content mode with line numbers', async () => {
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        if (filePath === '/test') {
          return { isFile: () => false, isDirectory: () => true } as any;
        }
        return { isFile: () => true, isDirectory: () => false } as any;
      });
      vi.mocked(mockFg).mockResolvedValue(['/test/file.txt']);
      vi.mocked(mockFsPromises.readFile).mockResolvedValue('line 1\ntest line\nline 3');

      const result = await localFileCtr.handleGrepContent({
        'pattern': 'test',
        'path': '/test',
        'output_mode': 'content',
        '-n': true,
      });

      expect(result.success).toBe(true);
      expect(result.matches.some((m) => m.includes('2:'))).toBe(true);
    });

    it('should return count mode', async () => {
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        if (filePath === '/test') {
          return { isFile: () => false, isDirectory: () => true } as any;
        }
        return { isFile: () => true, isDirectory: () => false } as any;
      });
      vi.mocked(mockFg).mockResolvedValue(['/test/file.txt']);
      vi.mocked(mockFsPromises.readFile).mockResolvedValue('test one\ntest two\ntest three');

      const result = await localFileCtr.handleGrepContent({
        pattern: 'test',
        path: '/test',
        output_mode: 'count',
      });

      expect(result.success).toBe(true);
      expect(result.matches).toContain('/test/file.txt:3');
      expect(result.total_matches).toBe(3);
    });

    it('should respect head_limit', async () => {
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        if (filePath === '/test') {
          return { isFile: () => false, isDirectory: () => true } as any;
        }
        return { isFile: () => true, isDirectory: () => false } as any;
      });
      vi.mocked(mockFg).mockResolvedValue([
        '/test/file1.txt',
        '/test/file2.txt',
        '/test/file3.txt',
        '/test/file4.txt',
        '/test/file5.txt',
      ]);
      vi.mocked(mockFsPromises.readFile).mockResolvedValue('test content');

      const result = await localFileCtr.handleGrepContent({
        pattern: 'test',
        path: '/test',
        head_limit: 2,
      });

      expect(result.success).toBe(true);
      expect(result.matches.length).toBe(2);
    });

    it('should handle case insensitive search', async () => {
      vi.mocked(mockFsPromises.stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
      } as any);
      vi.mocked(mockFsPromises.readFile).mockResolvedValue('Hello World\nHELLO world\nhello WORLD');

      const result = await localFileCtr.handleGrepContent({
        'pattern': 'hello',
        'path': '/test/file.txt',
        '-i': true,
      });

      expect(result.success).toBe(true);
      expect(result.matches).toContain('/test/file.txt');
    });

    it('should handle grep error gracefully', async () => {
      vi.mocked(mockFsPromises.stat).mockRejectedValue(new Error('Path not found'));

      const result = await localFileCtr.handleGrepContent({
        pattern: 'test',
        path: '/nonexistent',
      });

      expect(result.success).toBe(false);
      expect(result.matches).toEqual([]);
      expect(result.total_matches).toBe(0);
    });

    it('should skip unreadable files gracefully', async () => {
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        if (filePath === '/test') {
          return { isFile: () => false, isDirectory: () => true } as any;
        }
        return { isFile: () => true, isDirectory: () => false } as any;
      });
      vi.mocked(mockFg).mockResolvedValue(['/test/file1.txt', '/test/file2.txt']);
      vi.mocked(mockFsPromises.readFile).mockImplementation(async (filePath) => {
        if (filePath === '/test/file1.txt') throw new Error('Permission denied');
        return 'test content';
      });

      const result = await localFileCtr.handleGrepContent({
        pattern: 'test',
        path: '/test',
      });

      expect(result.success).toBe(true);
      // Should still find match in file2.txt despite file1.txt error
      expect(result.matches).toContain('/test/file2.txt');
    });
  });
});
