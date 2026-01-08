import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileModel } from '@/database/models/file';

import { S3StaticFileImpl } from './s3';

const config = {
  S3_ENABLE_PATH_STYLE: false,
  S3_PUBLIC_DOMAIN: 'https://example.com',
  S3_BUCKET: 'my-bucket',
  S3_SET_ACL: true,
};

// 模拟 fileEnv
vi.mock('@/envs/file', () => ({
  get fileEnv() {
    return config;
  },
}));

// 模拟 S3 类
vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn().mockImplementation(() => ({
    createPreSignedUrlForPreview: vi
      .fn()
      .mockResolvedValue('https://presigned.example.com/test.jpg'),
    getFileContent: vi.fn().mockResolvedValue('file content'),
    getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    getFileMetadata: vi.fn().mockResolvedValue({ contentLength: 1024, contentType: 'image/png' }),
    deleteFile: vi.fn().mockResolvedValue({}),
    deleteFiles: vi.fn().mockResolvedValue({}),
    createPreSignedUrl: vi.fn().mockResolvedValue('https://upload.example.com/test.jpg'),
    uploadContent: vi.fn().mockResolvedValue({}),
    uploadMedia: vi.fn().mockResolvedValue({}),
  })),
}));

// Mock db
const mockDb = {} as any;

describe('S3StaticFileImpl', () => {
  let fileService: S3StaticFileImpl;

  beforeEach(() => {
    fileService = new S3StaticFileImpl(mockDb);
  });

  describe('getFullFileUrl', () => {
    it('should return empty string for null or undefined input', async () => {
      expect(await fileService.getFullFileUrl(null)).toBe('');
      expect(await fileService.getFullFileUrl(undefined)).toBe('');
    });

    it('当S3_SET_ACL为false时应返回预签名URL', async () => {
      config.S3_SET_ACL = false;
      const url = 'path/to/file.jpg';
      expect(await fileService.getFullFileUrl(url)).toBe('https://presigned.example.com/test.jpg');
      config.S3_SET_ACL = true;
    });

    it('should return correct URL when S3_ENABLE_PATH_STYLE is false', async () => {
      const url = 'path/to/file.jpg';
      expect(await fileService.getFullFileUrl(url)).toBe('https://example.com/path/to/file.jpg');
    });

    it('should return correct URL when S3_ENABLE_PATH_STYLE is true', async () => {
      config.S3_ENABLE_PATH_STYLE = true;
      const url = 'path/to/file.jpg';
      expect(await fileService.getFullFileUrl(url)).toBe(
        'https://example.com/my-bucket/path/to/file.jpg',
      );
      config.S3_ENABLE_PATH_STYLE = false;
    });

    // Legacy bug compatibility tests - https://github.com/lobehub/lobe-chat/issues/8994
    describe('legacy bug compatibility', () => {
      it('should handle full URL input by extracting key (S3_SET_ACL=false)', async () => {
        config.S3_SET_ACL = false;
        const fullUrl = 'https://s3.example.com/bucket/path/to/file.jpg?X-Amz-Signature=expired';

        // Mock getKeyFromFullUrl to return the extracted key
        vi.spyOn(fileService, 'getKeyFromFullUrl').mockResolvedValue('path/to/file.jpg');

        const result = await fileService.getFullFileUrl(fullUrl);

        expect(fileService.getKeyFromFullUrl).toHaveBeenCalledWith(fullUrl);
        expect(result).toBe('https://presigned.example.com/test.jpg');
        config.S3_SET_ACL = true;
      });

      it('should handle full URL input by extracting key (S3_SET_ACL=true)', async () => {
        const fullUrl = 'https://s3.example.com/bucket/path/to/file.jpg';

        vi.spyOn(fileService, 'getKeyFromFullUrl').mockResolvedValue('path/to/file.jpg');

        const result = await fileService.getFullFileUrl(fullUrl);

        expect(fileService.getKeyFromFullUrl).toHaveBeenCalledWith(fullUrl);
        expect(result).toBe('https://example.com/path/to/file.jpg');
      });

      it('should handle normal key input without extraction', async () => {
        const key = 'path/to/file.jpg';

        const spy = vi.spyOn(fileService, 'getKeyFromFullUrl');

        const result = await fileService.getFullFileUrl(key);

        expect(spy).not.toHaveBeenCalled();
        expect(result).toBe('https://example.com/path/to/file.jpg');
      });

      it('should handle http:// URLs for legacy compatibility', async () => {
        const httpUrl = 'http://s3.example.com/bucket/path/to/file.jpg';

        vi.spyOn(fileService, 'getKeyFromFullUrl').mockResolvedValue('path/to/file.jpg');

        const result = await fileService.getFullFileUrl(httpUrl);

        expect(fileService.getKeyFromFullUrl).toHaveBeenCalledWith(httpUrl);
        expect(result).toBe('https://example.com/path/to/file.jpg');
      });

      it('should throw error when key extraction returns null', async () => {
        const fullUrl = 'https://s3.example.com/f/nonexistent';

        vi.spyOn(fileService, 'getKeyFromFullUrl').mockResolvedValue(null);

        await expect(fileService.getFullFileUrl(fullUrl)).rejects.toThrow(
          'Key not found from url: ' + fullUrl,
        );
      });
    });
  });

  describe('getFileContent', () => {
    it('应该返回文件内容', async () => {
      expect(await fileService.getFileContent('test.txt')).toBe('file content');
    });
  });

  describe('getFileByteArray', () => {
    it('应该返回文件字节数组', async () => {
      const result = await fileService.getFileByteArray('test.jpg');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(3);
    });
  });

  describe('deleteFile', () => {
    it('应该调用S3的deleteFile方法', async () => {
      await fileService.deleteFile('test.jpg');
      expect(fileService['s3'].deleteFile).toHaveBeenCalledWith('test.jpg');
    });
  });

  describe('deleteFiles', () => {
    it('应该调用S3的deleteFiles方法', async () => {
      await fileService.deleteFiles(['test1.jpg', 'test2.jpg']);
      expect(fileService['s3'].deleteFiles).toHaveBeenCalledWith(['test1.jpg', 'test2.jpg']);
    });
  });

  describe('createPreSignedUrl', () => {
    it('应该调用S3的createPreSignedUrl方法', async () => {
      const result = await fileService.createPreSignedUrl('test.jpg');
      expect(result).toBe('https://upload.example.com/test.jpg');
    });
  });

  describe('getFileMetadata', () => {
    it('should call S3 getFileMetadata and return metadata', async () => {
      const result = await fileService.getFileMetadata('test.png');

      expect(fileService['s3'].getFileMetadata).toHaveBeenCalledWith('test.png');
      expect(result).toEqual({ contentLength: 1024, contentType: 'image/png' });
    });

    it('should handle S3 errors', async () => {
      const error = new Error('File not found');
      fileService['s3'].getFileMetadata = vi.fn().mockRejectedValue(error);

      await expect(fileService.getFileMetadata('non-existent.txt')).rejects.toThrow(
        'File not found',
      );
    });
  });

  describe('uploadContent', () => {
    it('应该调用S3的uploadContent方法', async () => {
      await fileService.uploadContent('test.jpg', 'content');
      expect(fileService['s3'].uploadContent).toHaveBeenCalledWith('test.jpg', 'content');
    });
  });

  describe('getKeyFromFullUrl', () => {
    it('should extract fileId from proxy URL and return S3 key from database', async () => {
      const proxyUrl = 'http://localhost:3010/f/abc123';
      const expectedKey = 'ppp/491067/image.jpg';

      vi.spyOn(FileModel, 'getFileById').mockResolvedValue({ url: expectedKey } as any);

      const result = await fileService.getKeyFromFullUrl(proxyUrl);

      expect(FileModel.getFileById).toHaveBeenCalledWith(mockDb, 'abc123');
      expect(result).toBe(expectedKey);
    });

    it('should return null when file is not found in database', async () => {
      const proxyUrl = 'http://localhost:3010/f/nonexistent';

      vi.spyOn(FileModel, 'getFileById').mockResolvedValue(undefined);

      const result = await fileService.getKeyFromFullUrl(proxyUrl);

      expect(FileModel.getFileById).toHaveBeenCalledWith(mockDb, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should handle URL with different domain', async () => {
      const proxyUrl = 'https://example.com/f/file456';
      const expectedKey = 'uploads/file.png';

      vi.spyOn(FileModel, 'getFileById').mockResolvedValue({ url: expectedKey } as any);

      const result = await fileService.getKeyFromFullUrl(proxyUrl);

      expect(FileModel.getFileById).toHaveBeenCalledWith(mockDb, 'file456');
      expect(result).toBe(expectedKey);
    });

    it('should extract key from legacy S3 URL (non /f/ path)', async () => {
      const s3Url = 'https://example.com/path/to/file.jpg';

      const result = await fileService.getKeyFromFullUrl(s3Url);

      // Legacy S3 URL: extract key from pathname
      expect(result).toBe('path/to/file.jpg');
    });

    it('should extract key with path-style S3 URL', async () => {
      config.S3_ENABLE_PATH_STYLE = true;
      const s3Url = 'https://example.com/my-bucket/path/to/file.jpg';

      const result = await fileService.getKeyFromFullUrl(s3Url);

      expect(result).toBe('path/to/file.jpg');
      config.S3_ENABLE_PATH_STYLE = false;
    });

    it('should return null for invalid URL', async () => {
      const invalidUrl = 'not-a-valid-url';

      const result = await fileService.getKeyFromFullUrl(invalidUrl);

      expect(result).toBeNull();
    });
  });

  describe('uploadMedia', () => {
    beforeEach(() => {
      // 重置 S3 mock
      vi.clearAllMocks();
    });

    it('应该调用S3的uploadMedia方法并返回key', async () => {
      // 准备
      const testKey = 'images/test.jpg';
      const testBuffer = Buffer.from('fake image data');

      fileService['s3'].uploadMedia = vi.fn().mockResolvedValue(undefined);

      // 执行
      const result = await fileService.uploadMedia(testKey, testBuffer);

      // 验证
      expect(fileService['s3'].uploadMedia).toHaveBeenCalledWith(testKey, testBuffer);
      expect(result).toEqual({ key: testKey });
    });

    it('应该正确处理不同类型的媒体文件', async () => {
      // 准备
      const testKey = 'videos/test.mp4';
      const testBuffer = Buffer.from('fake video data');

      fileService['s3'].uploadMedia = vi.fn().mockResolvedValue(undefined);

      // 执行
      const result = await fileService.uploadMedia(testKey, testBuffer);

      // 验证
      expect(fileService['s3'].uploadMedia).toHaveBeenCalledWith(testKey, testBuffer);
      expect(result).toEqual({ key: testKey });
    });

    it('当S3上传失败时应该抛出错误', async () => {
      // 准备
      const testKey = 'images/test.jpg';
      const testBuffer = Buffer.from('fake image data');
      const uploadError = new Error('S3 upload failed');

      fileService['s3'].uploadMedia = vi.fn().mockRejectedValue(uploadError);

      // 执行和验证
      await expect(fileService.uploadMedia(testKey, testBuffer)).rejects.toThrow(
        'S3 upload failed',
      );
      expect(fileService['s3'].uploadMedia).toHaveBeenCalledWith(testKey, testBuffer);
    });
  });
});
