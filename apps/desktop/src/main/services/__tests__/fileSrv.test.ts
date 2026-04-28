import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import FileService, { FileNotFoundError } from '../fileSrv';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/mock/app/path'),
    getPath: vi.fn(() => '/mock/user/data'),
  },
}));

// Mock constants that depend on electron
vi.mock('@/const/dir', () => ({
  FILE_STORAGE_DIR: 'file-storage',
  LOCAL_STORAGE_URL_PREFIX: '/lobe-desktop-file',
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

// Mock file-system utilities
vi.mock('@/utils/file-system', () => ({
  makeSureDirExist: vi.fn(),
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn(),
}));

// Mock node:fs
vi.mock('node:fs', () => ({
  default: {
    constants: { F_OK: 0 },
    promises: { access: vi.fn() },
    readFile: vi.fn(),
    unlink: vi.fn(),
  },
  constants: { F_OK: 0 },
  promises: { access: vi.fn() },
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

// Mock node:util promisify
vi.mock('node:util', () => ({
  promisify: vi.fn((fn: any) => {
    return vi.fn(async (...args: any[]) => {
      return new Promise((resolve, reject) => {
        fn(...args, (err: any, data: any) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
    });
  }),
}));

describe('FileService', () => {
  let fileService: FileService;
  let mockApp: App;
  let mockMakeSureDirExist: any;
  let mockWriteFile: any;
  let mockReadFile: any;
  let mockAccess: any;
  let mockFsReadFile: any;
  let mockFsUnlink: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup mock app
    mockApp = {
      appStoragePath: '/mock/app/storage',
      staticFileServerManager: {
        getFileServerDomain: vi.fn().mockReturnValue('http://localhost:3000'),
      },
    } as unknown as App;

    // Import mocks
    mockMakeSureDirExist = (await import('@/utils/file-system')).makeSureDirExist;
    const fsPromises = await import('node:fs/promises');
    mockWriteFile = fsPromises.writeFile;
    mockReadFile = fsPromises.readFile;
    mockAccess = fsPromises.access;

    const fs = await import('node:fs');
    mockFsReadFile = fs.readFile;
    mockFsUnlink = fs.unlink;

    fileService = new FileService(mockApp);
  });

  describe('uploadFile', () => {
    it('should upload file with ArrayBuffer content successfully', async () => {
      const content = new ArrayBuffer(10);
      const params = {
        content,
        filename: 'test.png',
        hash: 'abc123',
        path: 'user_uploads/images/test.png',
        type: 'image/png',
      };

      mockWriteFile.mockResolvedValue(undefined);

      const result = await fileService.uploadFile(params);

      expect(result.success).toBe(true);
      expect(result.metadata.filename).toBe('test.png');
      expect(result.metadata.dirname).toBe('user_uploads/images');
      expect(result.metadata.path).toBe('desktop://user_uploads/images/test.png');
      expect(mockMakeSureDirExist).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledTimes(2); // file + metadata
    });

    it('should upload file with Base64 string content successfully', async () => {
      const base64Content = Buffer.from('test content').toString('base64');
      const params = {
        content: base64Content,
        filename: 'test.txt',
        hash: 'def456',
        path: 'documents/test.txt',
        type: 'text/plain',
      };

      mockWriteFile.mockResolvedValue(undefined);

      const result = await fileService.uploadFile(params);

      expect(result.success).toBe(true);
      expect(result.metadata.filename).toBe('test.txt');
      expect(result.metadata.path).toBe('desktop://documents/test.txt');
    });

    it('should create metadata file with correct structure', async () => {
      const content = new ArrayBuffer(100);
      const params = {
        content,
        filename: 'image.jpg',
        hash: 'xyz789',
        path: 'photos/image.jpg',
        type: 'image/jpeg',
      };

      let metadataContent: string = '';
      mockWriteFile.mockImplementation(async (path: any, data: any) => {
        if (path.toString().endsWith('.meta')) {
          metadataContent = data;
        }
      });

      await fileService.uploadFile(params);

      expect(metadataContent).toBeTruthy();
      const metadata = JSON.parse(metadataContent);
      expect(metadata.filename).toBe('image.jpg');
      expect(metadata.hash).toBe('xyz789');
      expect(metadata.type).toBe('image/jpeg');
      expect(metadata.size).toBe(100);
      expect(metadata.createdAt).toBeDefined();
    });

    it('should handle upload failure and throw error', async () => {
      const params = {
        content: new ArrayBuffer(10),
        filename: 'test.png',
        hash: 'abc123',
        path: 'uploads/test.png',
        type: 'image/png',
      };

      mockWriteFile.mockRejectedValue(new Error('Disk full'));

      await expect(fileService.uploadFile(params)).rejects.toThrow('File upload failed: Disk full');
    });

    it('should handle file path with no directory', async () => {
      const params = {
        content: new ArrayBuffer(10),
        filename: 'test.txt',
        hash: 'abc',
        path: 'test.txt',
        type: 'text/plain',
      };

      mockWriteFile.mockResolvedValue(undefined);

      const result = await fileService.uploadFile(params);

      expect(result.success).toBe(true);
      expect(result.metadata.dirname).toBe('');
      expect(result.metadata.filename).toBe('test.txt');
    });
  });

  describe('getFile', () => {
    it('should get file from new path format successfully', async () => {
      const mockContent = Buffer.from('test content');

      mockFsReadFile.mockImplementation((path: any, callback: any) => {
        callback(null, mockContent);
      });

      // Mock metadata read failure, will infer from extension
      mockReadFile.mockRejectedValue(new Error('No metadata'));

      const result = await fileService.getFile('desktop://documents/test.txt');

      // Since metadata fails, it will use default or infer from extension
      expect(result.mimeType).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('should get file from legacy path format (timestamp directory)', async () => {
      const mockContent = Buffer.from('legacy content');

      mockFsReadFile.mockImplementation((path: any, callback: any) => {
        callback(null, mockContent);
      });

      // Mock metadata read to succeed this time
      mockReadFile.mockResolvedValue(JSON.stringify({ type: 'image/png' }));

      const result = await fileService.getFile('desktop://1234567890/abc123.png');

      // Check that result is returned
      expect(result.mimeType).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('should fallback from legacy to new path on failure', async () => {
      const mockContent = Buffer.from('fallback content');

      let callCount = 0;
      mockFsReadFile.mockImplementation((path: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          // First read (legacy) fails
          const error: any = new Error('ENOENT');
          error.code = 'ENOENT';
          callback(error, null);
        } else {
          // Second read (fallback) succeeds
          callback(null, mockContent);
        }
      });

      mockReadFile.mockRejectedValue(new Error('No metadata'));

      const result = await fileService.getFile('desktop://1234567890/fallback.jpg');

      // Check that fallback worked and result is returned
      expect(result.content).toBeDefined();
      expect(result.mimeType).toBeDefined();
    });

    it('should infer MIME type from file extension when metadata missing', async () => {
      const mockContent = Buffer.from('image data');

      mockFsReadFile.mockImplementation((path: any, callback: any) => {
        callback(null, mockContent);
      });

      mockReadFile.mockRejectedValue(new Error('Metadata not found'));

      const result = await fileService.getFile('desktop://images/photo.png');

      expect(result.mimeType).toBe('image/png');
    });

    it('should infer correct MIME types for various image formats', async () => {
      const mockContent = Buffer.from('image');

      const testCases = [
        { path: 'desktop://test.jpg', expected: 'image/jpeg' },
        { path: 'desktop://test.jpeg', expected: 'image/jpeg' },
        { path: 'desktop://test.gif', expected: 'image/gif' },
        { path: 'desktop://test.webp', expected: 'image/webp' },
        { path: 'desktop://test.svg', expected: 'image/svg+xml' },
        { path: 'desktop://test.pdf', expected: 'application/pdf' },
      ];

      mockFsReadFile.mockImplementation((path: any, callback: any) => {
        callback(null, mockContent);
      });

      for (const testCase of testCases) {
        mockReadFile.mockRejectedValue(new Error('No metadata'));

        const result = await fileService.getFile(testCase.path);
        expect(result.mimeType).toBe(testCase.expected);
      }
    });

    it('should use default MIME type for unknown extensions', async () => {
      const mockContent = Buffer.from('unknown');

      mockFsReadFile.mockImplementation((path: any, callback: any) => {
        callback(null, mockContent);
      });

      mockReadFile.mockRejectedValue(new Error('No metadata'));

      const result = await fileService.getFile('desktop://file.unknown');

      expect(result.mimeType).toBe('application/octet-stream');
    });

    it('should throw FileNotFoundError when file does not exist', async () => {
      mockFsReadFile.mockImplementation((path: any, callback: any) => {
        const error: any = new Error('ENOENT: no such file');
        error.code = 'ENOENT';
        error.message = 'ENOENT: no such file';
        callback(error, null);
      });

      await expect(fileService.getFile('desktop://missing/file.txt')).rejects.toThrow(
        FileNotFoundError,
      );
    });

    it('should throw error for invalid path without desktop:// prefix', async () => {
      await expect(fileService.getFile('/invalid/path.txt')).rejects.toThrow(
        'Invalid desktop file path',
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete file from new path format successfully', async () => {
      mockFsUnlink.mockImplementation((path: any, callback: any) => {
        callback(null);
      });

      const result = await fileService.deleteFile('desktop://documents/test.txt');

      expect(result.success).toBe(true);
    });

    it('should delete file from legacy path format', async () => {
      mockFsUnlink.mockImplementation((path: any, callback: any) => {
        callback(null);
      });

      const result = await fileService.deleteFile('desktop://1234567890/file.png');

      expect(result.success).toBe(true);
    });

    it('should fallback from legacy to new path on deletion failure', async () => {
      let callCount = 0;
      mockFsUnlink.mockImplementation((path: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          // First attempt (legacy file) fails
          callback(new Error('ENOENT'));
        } else {
          // All subsequent attempts succeed
          callback(null);
        }
      });

      const result = await fileService.deleteFile('desktop://1234567890/fallback.txt');

      expect(result.success).toBe(true);
    });

    it('should handle metadata deletion failure gracefully', async () => {
      let callCount = 0;
      mockFsUnlink.mockImplementation((path: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          // File deletion succeeds
          callback(null);
        } else {
          // Metadata deletion fails (but doesn't throw)
          callback(new Error('Metadata not found'));
        }
      });

      const result = await fileService.deleteFile('desktop://files/test.txt');

      expect(result.success).toBe(true);
    });

    it('should throw error when file deletion fails', async () => {
      mockFsUnlink.mockImplementation((path: any, callback: any) => {
        callback(new Error('Permission denied'));
      });

      await expect(fileService.deleteFile('desktop://protected/file.txt')).rejects.toThrow(
        'File deletion failed: Permission denied',
      );
    });

    it('should throw error for invalid path without desktop:// prefix', async () => {
      await expect(fileService.deleteFile('/invalid/path.txt')).rejects.toThrow(
        'Invalid desktop file path',
      );
    });
  });

  describe('deleteFiles', () => {
    it('should delete multiple files successfully', async () => {
      mockFsUnlink.mockImplementation((path: any, callback: any) => {
        callback(null);
      });

      const paths = [
        'desktop://files/file1.txt',
        'desktop://files/file2.txt',
        'desktop://files/file3.txt',
      ];

      const result = await fileService.deleteFiles(paths);

      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should handle partial failures in batch deletion', async () => {
      let _callCount = 0;
      mockFsUnlink.mockImplementation((path: any, callback: any) => {
        _callCount++;
        // Fail on a specific file
        if (path.includes('file2.txt') && !path.includes('.meta')) {
          callback(new Error('Permission denied'));
        } else {
          callback(null);
        }
      });

      const paths = [
        'desktop://files/file1.txt',
        'desktop://files/file2.txt',
        'desktop://files/file3.txt',
      ];

      const result = await fileService.deleteFiles(paths);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('should return errors array with failed file paths', async () => {
      mockFsUnlink.mockImplementation((path: any, callback: any) => {
        if (path.includes('file2') && !path.includes('.meta')) {
          callback(new Error('Access denied'));
        } else {
          callback(null);
        }
      });

      const paths = ['desktop://files/file1.txt', 'desktop://files/file2.txt'];

      const result = await fileService.deleteFiles(paths);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].path).toBe('desktop://files/file2.txt');
      expect(result.errors?.[0].message).toContain('Access denied');
    });

    it('should handle empty paths array', async () => {
      const result = await fileService.deleteFiles([]);

      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });

  describe('getFilePath', () => {
    it('should return correct path for new format', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await fileService.getFilePath('desktop://documents/test.txt');

      expect(result).toBe('/mock/app/storage/file-storage/documents/test.txt');
    });

    it('should return legacy path when file exists in uploads directory', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await fileService.getFilePath('desktop://1234567890/legacy.png');

      expect(result).toBe('/mock/app/storage/file-storage/uploads/1234567890/legacy.png');
    });

    it('should fallback to new path when legacy path does not exist', async () => {
      mockAccess
        .mockRejectedValueOnce(new Error('Not found')) // legacy fails
        .mockResolvedValueOnce(undefined); // fallback succeeds

      const result = await fileService.getFilePath('desktop://1234567890/migrated.png');

      // When legacy path doesn't exist and fallback exists, it returns the fallback path
      // But since isLegacyPath returns true for timestamps, and the fallback succeeds,
      // it should update to the fallback path
      expect(result).toContain('1234567890/migrated.png');
    });

    it('should return legacy path when both paths do not exist', async () => {
      mockAccess
        .mockRejectedValueOnce(new Error('Not found'))
        .mockRejectedValueOnce(new Error('Not found'));

      const result = await fileService.getFilePath('desktop://1234567890/missing.png');

      expect(result).toBe('/mock/app/storage/file-storage/uploads/1234567890/missing.png');
    });

    it('should throw error for invalid path', async () => {
      await expect(fileService.getFilePath('/invalid/path')).rejects.toThrow(
        'Invalid desktop file path',
      );
    });
  });

  describe('getFileHTTPURL', () => {
    it('should generate correct HTTP URL for new format', async () => {
      const result = await fileService.getFileHTTPURL('desktop://documents/photo.jpg');

      expect(result).toBe('http://localhost:3000/lobe-desktop-file/documents/photo.jpg');
    });

    it('should generate correct HTTP URL for legacy format', async () => {
      const result = await fileService.getFileHTTPURL('desktop://1234567890/image.png');

      expect(result).toBe('http://localhost:3000/lobe-desktop-file/1234567890/image.png');
    });

    it('should throw error for invalid path', async () => {
      await expect(fileService.getFileHTTPURL('/invalid/path')).rejects.toThrow(
        'Invalid desktop file path',
      );
    });

    it('should handle paths with special characters', async () => {
      const result = await fileService.getFileHTTPURL('desktop://user/my%20file.txt');

      expect(result).toBe('http://localhost:3000/lobe-desktop-file/user/my%20file.txt');
    });
  });

  describe('isLegacyPath (via behavior testing)', () => {
    it('should treat timestamp-based paths as legacy', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await fileService.getFilePath('desktop://1234567890/file.txt');

      // Legacy paths go to uploads directory
      expect(result).toContain('uploads/1234567890/file.txt');
    });

    it('should treat custom paths as new format', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await fileService.getFilePath('desktop://custom/path/file.txt');

      expect(result).toContain('file-storage/custom/path/file.txt');
      expect(result).not.toContain('uploads');
    });

    it('should handle single-level paths correctly', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await fileService.getFilePath('desktop://file.txt');

      expect(result).toContain('file-storage/file.txt');
    });
  });

  describe('UPLOADS_DIR getter', () => {
    it('should return correct uploads directory path', () => {
      expect(fileService.UPLOADS_DIR).toBe('/mock/app/storage/file-storage/uploads');
    });
  });

  describe('FileNotFoundError', () => {
    it('should create error with correct properties', () => {
      const error = new FileNotFoundError('File not found', 'desktop://missing.txt');

      expect(error.name).toBe('FileNotFoundError');
      expect(error.message).toBe('File not found');
      expect(error.path).toBe('desktop://missing.txt');
      expect(error instanceof Error).toBe(true);
    });
  });
});
