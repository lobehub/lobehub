import { beforeEach, describe, expect, it, vi } from 'vitest';

import  { type App } from '@/core/App';

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
  loadFile: vi.fn(),
  SYSTEM_FILES_TO_IGNORE: ['.DS_Store', 'Thumbs.db', '$RECYCLE.BIN'],
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
  glob: vi.fn(),
};

// Mock ContentSearchService
const mockContentSearchService = {
  grep: vi.fn(),
  astGrep: vi.fn(),
  checkToolAvailable: vi.fn(),
};

// Mock makeSureDirExist
vi.mock('@/utils/file-system', () => ({
  makeSureDirExist: vi.fn(),
}));

const mockApp = {
  getService: vi.fn((ServiceClass: any) => {
    // Return different mock based on service class name
    if (ServiceClass?.name === 'ContentSearchService') {
      return mockContentSearchService;
    }
    return mockSearchService;
  }),
  toolDetectorManager: {
    getBestTool: vi.fn(() => null), // No external tools available, use Node.js fallback
  },
} as unknown as App;

describe('LocalFileCtr', () => {
  let localFileCtr: LocalFileCtr;
  let mockShell: any;
  let mockLoadFile: any;
  let mockFsPromises: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import mocks
    mockShell = (await import('electron')).shell;
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
      const mockResult = {
        success: true,
        files: ['/test/file1.txt', '/test/file2.txt'],
        total_files: 2,
      };
      mockSearchService.glob.mockResolvedValue(mockResult);

      const result = await localFileCtr.handleGlobFiles({
        pattern: '*.txt',
        scope: '/test',
      });

      expect(result.success).toBe(true);
      expect(result.files).toEqual(['/test/file1.txt', '/test/file2.txt']);
      expect(result.total_files).toBe(2);
      expect(mockSearchService.glob).toHaveBeenCalledWith({
        pattern: '*.txt',
        scope: '/test',
      });
    });

    it('should handle glob error', async () => {
      const mockResult = {
        success: false,
        files: [],
        total_files: 0,
        error: 'Glob failed',
      };
      mockSearchService.glob.mockResolvedValue(mockResult);

      const result = await localFileCtr.handleGlobFiles({
        pattern: '*.txt',
      });

      expect(result).toEqual({
        success: false,
        files: [],
        total_files: 0,
        error: 'Glob failed',
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

  describe('listLocalFiles', () => {
    it('should list directory contents successfully', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['file1.txt', 'file2.txt', 'folder1']);
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        const name = (filePath as string).split('/').pop();
        if (name === 'folder1') {
          return {
            isDirectory: () => true,
            birthtime: new Date('2024-01-01'),
            mtime: new Date('2024-01-15'),
            atime: new Date('2024-01-20'),
            size: 4096,
          } as any;
        }
        return {
          isDirectory: () => false,
          birthtime: new Date('2024-01-02'),
          mtime: new Date('2024-01-10'),
          atime: new Date('2024-01-18'),
          size: 1024,
        } as any;
      });

      const result = await localFileCtr.listLocalFiles({ path: '/test' });

      expect(result.files).toHaveLength(3);
      expect(result.totalCount).toBe(3);
      expect(mockFsPromises.readdir).toHaveBeenCalledWith('/test');
    });

    it('should filter out system files like .DS_Store and Thumbs.db', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue([
        'file1.txt',
        '.DS_Store',
        'Thumbs.db',
        'folder1',
      ]);
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        const name = (filePath as string).split('/').pop();
        if (name === 'folder1') {
          return {
            isDirectory: () => true,
            birthtime: new Date('2024-01-01'),
            mtime: new Date('2024-01-15'),
            atime: new Date('2024-01-20'),
            size: 4096,
          } as any;
        }
        return {
          isDirectory: () => false,
          birthtime: new Date('2024-01-02'),
          mtime: new Date('2024-01-10'),
          atime: new Date('2024-01-18'),
          size: 1024,
        } as any;
      });

      const result = await localFileCtr.listLocalFiles({ path: '/test' });

      // Should only contain file1.txt and folder1, not .DS_Store or Thumbs.db
      expect(result.files).toHaveLength(2);
      expect(result.totalCount).toBe(2);
      expect(result.files.map((r) => r.name)).not.toContain('.DS_Store');
      expect(result.files.map((r) => r.name)).not.toContain('Thumbs.db');
      expect(result.files.map((r) => r.name)).toContain('folder1');
      expect(result.files.map((r) => r.name)).toContain('file1.txt');
    });

    it('should filter out $RECYCLE.BIN system folder', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['file1.txt', '$RECYCLE.BIN', 'folder1']);
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        const name = (filePath as string).split('/').pop();
        const isDir = name === 'folder1' || name === '$RECYCLE.BIN';
        return {
          isDirectory: () => isDir,
          birthtime: new Date('2024-01-01'),
          mtime: new Date('2024-01-15'),
          atime: new Date('2024-01-20'),
          size: isDir ? 4096 : 1024,
        } as any;
      });

      const result = await localFileCtr.listLocalFiles({ path: '/test' });

      // Should not contain $RECYCLE.BIN
      expect(result.files).toHaveLength(2);
      expect(result.totalCount).toBe(2);
      expect(result.files.map((r) => r.name)).not.toContain('$RECYCLE.BIN');
    });

    it('should sort by name ascending when specified', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['zebra.txt', 'alpha.txt', 'apple.txt']);
      vi.mocked(mockFsPromises.stat).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-15'),
        atime: new Date('2024-01-20'),
        size: 1024,
      } as any);

      const result = await localFileCtr.listLocalFiles({
        path: '/test',
        sortBy: 'name',
        sortOrder: 'asc',
      });

      expect(result.files.map((r) => r.name)).toEqual(['alpha.txt', 'apple.txt', 'zebra.txt']);
    });

    it('should sort by modifiedTime descending by default', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['old.txt', 'new.txt', 'mid.txt']);
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        const name = (filePath as string).split('/').pop();
        const dates: Record<string, Date> = {
          'new.txt': new Date('2024-01-20'),
          'mid.txt': new Date('2024-01-15'),
          'old.txt': new Date('2024-01-01'),
        };
        return {
          isDirectory: () => false,
          birthtime: new Date('2024-01-01'),
          mtime: dates[name!] || new Date('2024-01-01'),
          atime: new Date('2024-01-20'),
          size: 1024,
        } as any;
      });

      const result = await localFileCtr.listLocalFiles({ path: '/test' });

      // Default sort: modifiedTime descending (newest first)
      expect(result.files.map((r) => r.name)).toEqual(['new.txt', 'mid.txt', 'old.txt']);
    });

    it('should sort by size ascending when specified', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['large.txt', 'small.txt', 'medium.txt']);
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        const name = (filePath as string).split('/').pop();
        const sizes: Record<string, number> = {
          'large.txt': 10000,
          'medium.txt': 5000,
          'small.txt': 1000,
        };
        return {
          isDirectory: () => false,
          birthtime: new Date('2024-01-01'),
          mtime: new Date('2024-01-15'),
          atime: new Date('2024-01-20'),
          size: sizes[name!] || 1024,
        } as any;
      });

      const result = await localFileCtr.listLocalFiles({
        path: '/test',
        sortBy: 'size',
        sortOrder: 'asc',
      });

      expect(result.files.map((r) => r.name)).toEqual(['small.txt', 'medium.txt', 'large.txt']);
    });

    it('should apply limit parameter', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue([
        'file1.txt',
        'file2.txt',
        'file3.txt',
        'file4.txt',
        'file5.txt',
      ]);
      vi.mocked(mockFsPromises.stat).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-15'),
        atime: new Date('2024-01-20'),
        size: 1024,
      } as any);

      const result = await localFileCtr.listLocalFiles({
        path: '/test',
        limit: 3,
      });

      expect(result.files).toHaveLength(3);
      expect(result.totalCount).toBe(5); // Total is 5, but limited to 3
    });

    it('should use default limit of 100', async () => {
      // Create 150 files
      const files = Array.from({ length: 150 }, (_, i) => `file${i}.txt`);
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(files);
      vi.mocked(mockFsPromises.stat).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-15'),
        atime: new Date('2024-01-20'),
        size: 1024,
      } as any);

      const result = await localFileCtr.listLocalFiles({ path: '/test' });

      expect(result.files).toHaveLength(100);
      expect(result.totalCount).toBe(150); // Total is 150, but limited to 100
    });

    it('should sort by createdTime ascending when specified', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue([
        'newest.txt',
        'oldest.txt',
        'middle.txt',
      ]);
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        const name = (filePath as string).split('/').pop();
        const dates: Record<string, Date> = {
          'newest.txt': new Date('2024-03-01'),
          'middle.txt': new Date('2024-02-01'),
          'oldest.txt': new Date('2024-01-01'),
        };
        return {
          isDirectory: () => false,
          birthtime: dates[name!] || new Date('2024-01-01'),
          mtime: new Date('2024-01-15'),
          atime: new Date('2024-01-20'),
          size: 1024,
        } as any;
      });

      const result = await localFileCtr.listLocalFiles({
        path: '/test',
        sortBy: 'createdTime',
        sortOrder: 'asc',
      });

      expect(result.files.map((r) => r.name)).toEqual(['oldest.txt', 'middle.txt', 'newest.txt']);
    });

    it('should sort by createdTime descending when specified', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue([
        'newest.txt',
        'oldest.txt',
        'middle.txt',
      ]);
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        const name = (filePath as string).split('/').pop();
        const dates: Record<string, Date> = {
          'newest.txt': new Date('2024-03-01'),
          'middle.txt': new Date('2024-02-01'),
          'oldest.txt': new Date('2024-01-01'),
        };
        return {
          isDirectory: () => false,
          birthtime: dates[name!] || new Date('2024-01-01'),
          mtime: new Date('2024-01-15'),
          atime: new Date('2024-01-20'),
          size: 1024,
        } as any;
      });

      const result = await localFileCtr.listLocalFiles({
        path: '/test',
        sortBy: 'createdTime',
        sortOrder: 'desc',
      });

      expect(result.files.map((r) => r.name)).toEqual(['newest.txt', 'middle.txt', 'oldest.txt']);
    });

    it('should sort by name descending when specified', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['alpha.txt', 'zebra.txt', 'middle.txt']);
      vi.mocked(mockFsPromises.stat).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-15'),
        atime: new Date('2024-01-20'),
        size: 1024,
      } as any);

      const result = await localFileCtr.listLocalFiles({
        path: '/test',
        sortBy: 'name',
        sortOrder: 'desc',
      });

      expect(result.files.map((r) => r.name)).toEqual(['zebra.txt', 'middle.txt', 'alpha.txt']);
    });

    it('should sort by size descending when specified', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['small.txt', 'large.txt', 'medium.txt']);
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        const name = (filePath as string).split('/').pop();
        const sizes: Record<string, number> = {
          'large.txt': 10000,
          'medium.txt': 5000,
          'small.txt': 1000,
        };
        return {
          isDirectory: () => false,
          birthtime: new Date('2024-01-01'),
          mtime: new Date('2024-01-15'),
          atime: new Date('2024-01-20'),
          size: sizes[name!] || 1024,
        } as any;
      });

      const result = await localFileCtr.listLocalFiles({
        path: '/test',
        sortBy: 'size',
        sortOrder: 'desc',
      });

      expect(result.files.map((r) => r.name)).toEqual(['large.txt', 'medium.txt', 'small.txt']);
    });

    it('should sort by modifiedTime ascending when specified', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['old.txt', 'new.txt', 'mid.txt']);
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        const name = (filePath as string).split('/').pop();
        const dates: Record<string, Date> = {
          'new.txt': new Date('2024-01-20'),
          'mid.txt': new Date('2024-01-15'),
          'old.txt': new Date('2024-01-01'),
        };
        return {
          isDirectory: () => false,
          birthtime: new Date('2024-01-01'),
          mtime: dates[name!] || new Date('2024-01-01'),
          atime: new Date('2024-01-20'),
          size: 1024,
        } as any;
      });

      const result = await localFileCtr.listLocalFiles({
        path: '/test',
        sortBy: 'modifiedTime',
        sortOrder: 'asc',
      });

      expect(result.files.map((r) => r.name)).toEqual(['old.txt', 'mid.txt', 'new.txt']);
    });

    it('should handle empty directory with sort options', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue([]);

      const result = await localFileCtr.listLocalFiles({
        path: '/empty',
        sortBy: 'name',
        sortOrder: 'asc',
      });

      expect(result.files).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should apply limit after sorting', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue([
        'file1.txt',
        'file2.txt',
        'file3.txt',
        'file4.txt',
        'file5.txt',
      ]);
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        const name = (filePath as string).split('/').pop();
        const dates: Record<string, Date> = {
          'file1.txt': new Date('2024-01-01'),
          'file2.txt': new Date('2024-01-02'),
          'file3.txt': new Date('2024-01-03'),
          'file4.txt': new Date('2024-01-04'),
          'file5.txt': new Date('2024-01-05'),
        };
        return {
          isDirectory: () => false,
          birthtime: new Date('2024-01-01'),
          mtime: dates[name!] || new Date('2024-01-01'),
          atime: new Date('2024-01-20'),
          size: 1024,
        } as any;
      });

      // Sort by modifiedTime desc (default) and limit to 3
      const result = await localFileCtr.listLocalFiles({
        path: '/test',
        limit: 3,
      });

      // Should get the 3 newest files
      expect(result.files).toHaveLength(3);
      expect(result.totalCount).toBe(5); // Total is 5, but limited to 3
      expect(result.files.map((r) => r.name)).toEqual(['file5.txt', 'file4.txt', 'file3.txt']);
    });

    it('should handle limit larger than file count', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['file1.txt', 'file2.txt']);
      vi.mocked(mockFsPromises.stat).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-15'),
        atime: new Date('2024-01-20'),
        size: 1024,
      } as any);

      const result = await localFileCtr.listLocalFiles({
        path: '/test',
        limit: 1000,
      });

      expect(result.files).toHaveLength(2);
      expect(result.totalCount).toBe(2);
    });

    it('should return file metadata including size, times and type', async () => {
      const createdTime = new Date('2024-01-01');
      const modifiedTime = new Date('2024-01-15');
      const accessTime = new Date('2024-01-20');

      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['document.pdf']);
      vi.mocked(mockFsPromises.stat).mockResolvedValue({
        isDirectory: () => false,
        birthtime: createdTime,
        mtime: modifiedTime,
        atime: accessTime,
        size: 2048,
      } as any);

      const result = await localFileCtr.listLocalFiles({ path: '/test' });

      expect(result.files).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.files[0]).toEqual({
        name: 'document.pdf',
        path: '/test/document.pdf',
        isDirectory: false,
        size: 2048,
        type: 'pdf',
        createdTime,
        modifiedTime,
        lastAccessTime: accessTime,
      });
    });

    it('should return empty result when directory read fails', async () => {
      vi.mocked(mockFsPromises.readdir).mockRejectedValue(new Error('Permission denied'));

      const result = await localFileCtr.listLocalFiles({ path: '/protected' });

      expect(result.files).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should skip files that cannot be stat', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['good.txt', 'bad.txt']);
      vi.mocked(mockFsPromises.stat).mockImplementation(async (filePath) => {
        if ((filePath as string).includes('bad.txt')) {
          throw new Error('Cannot stat file');
        }
        return {
          isDirectory: () => false,
          birthtime: new Date('2024-01-01'),
          mtime: new Date('2024-01-15'),
          atime: new Date('2024-01-20'),
          size: 1024,
        } as any;
      });

      const result = await localFileCtr.listLocalFiles({ path: '/test' });

      // Should only contain good.txt, bad.txt should be skipped
      expect(result.files).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.files[0].name).toBe('good.txt');
    });

    it('should handle directory type correctly', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['my_folder']);
      vi.mocked(mockFsPromises.stat).mockResolvedValue({
        isDirectory: () => true,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-15'),
        atime: new Date('2024-01-20'),
        size: 4096,
      } as any);

      const result = await localFileCtr.listLocalFiles({ path: '/test' });

      expect(result.files).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.files[0].isDirectory).toBe(true);
      expect(result.files[0].type).toBe('directory');
    });

    it('should handle files without extension', async () => {
      vi.mocked(mockFsPromises.readdir).mockResolvedValue(['Makefile', 'README']);
      vi.mocked(mockFsPromises.stat).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-15'),
        atime: new Date('2024-01-20'),
        size: 512,
      } as any);

      const result = await localFileCtr.listLocalFiles({ path: '/test' });

      expect(result.files).toHaveLength(2);
      expect(result.totalCount).toBe(2);
      // Files without extension should have empty type
      expect(result.files[0].type).toBe('');
      expect(result.files[1].type).toBe('');
    });
  });

  describe('handleGrepContent', () => {
    beforeEach(() => {
      vi.mocked(mockContentSearchService.grep).mockReset();
    });

    it('should delegate grep to contentSearchService', async () => {
      const mockResult = {
        success: true,
        matches: ['/test/file.txt'],
        total_matches: 1,
      };
      vi.mocked(mockContentSearchService.grep).mockResolvedValue(mockResult);

      const params = {
        'pattern': 'test',
        'path': '/test/file.txt',
        '-i': true,
      };

      const result = await localFileCtr.handleGrepContent(params);

      expect(mockContentSearchService.grep).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockResult);
    });

    it('should return error result from contentSearchService', async () => {
      const mockResult = {
        success: false,
        matches: [],
        total_matches: 0,
        error: 'Search failed',
      };
      vi.mocked(mockContentSearchService.grep).mockResolvedValue(mockResult);

      const result = await localFileCtr.handleGrepContent({
        pattern: 'test',
        path: '/nonexistent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Search failed');
    });

    it('should pass all parameters to contentSearchService', async () => {
      const mockResult = {
        success: true,
        matches: ['/test/file.txt:2:test line'],
        total_matches: 1,
      };
      vi.mocked(mockContentSearchService.grep).mockResolvedValue(mockResult);

      const params = {
        'pattern': 'test',
        'path': '/test',
        'output_mode': 'content' as const,
        '-n': true,
        '-i': true,
        'glob': '*.ts',
        'head_limit': 10,
      };

      await localFileCtr.handleGrepContent(params);

      expect(mockContentSearchService.grep).toHaveBeenCalledWith(params);
    });
  });
});
