import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    deleteFile: vi.fn().mockResolvedValue({}),
    deleteFiles: vi.fn().mockResolvedValue({}),
    createPreSignedUrl: vi.fn().mockResolvedValue('https://upload.example.com/test.jpg'),
    uploadContent: vi.fn().mockResolvedValue({}),
    uploadMedia: vi.fn().mockResolvedValue({}),
  })),
}));

describe('S3StaticFileImpl', () => {
  let fileService: S3StaticFileImpl;

  beforeEach(() => {
    fileService = new S3StaticFileImpl();
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
        vi.spyOn(fileService, 'getKeyFromFullUrl').mockReturnValue('path/to/file.jpg');

        const result = await fileService.getFullFileUrl(fullUrl);

        expect(fileService.getKeyFromFullUrl).toHaveBeenCalledWith(fullUrl);
        expect(result).toBe('https://presigned.example.com/test.jpg');
        config.S3_SET_ACL = true;
      });

      it('should handle full URL input by extracting key (S3_SET_ACL=true)', async () => {
        const fullUrl = 'https://s3.example.com/bucket/path/to/file.jpg';

        vi.spyOn(fileService, 'getKeyFromFullUrl').mockReturnValue('path/to/file.jpg');

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

        vi.spyOn(fileService, 'getKeyFromFullUrl').mockReturnValue('path/to/file.jpg');

        const result = await fileService.getFullFileUrl(httpUrl);

        expect(fileService.getKeyFromFullUrl).toHaveBeenCalledWith(httpUrl);
        expect(result).toBe('https://example.com/path/to/file.jpg');
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

  describe('uploadContent', () => {
    it('应该调用S3的uploadContent方法', async () => {
      await fileService.uploadContent('test.jpg', 'content');
      expect(fileService['s3'].uploadContent).toHaveBeenCalledWith('test.jpg', 'content');
    });
  });

  describe('getKeyFromFullUrl', () => {
    it('当S3_ENABLE_PATH_STYLE为false时应该正确提取key', () => {
      config.S3_ENABLE_PATH_STYLE = false;
      const url = 'https://example.com/path/to/file.jpg';

      const result = fileService.getKeyFromFullUrl(url);

      expect(result).toBe('path/to/file.jpg');
      config.S3_ENABLE_PATH_STYLE = false; // reset
    });

    it('当S3_ENABLE_PATH_STYLE为true时应该正确提取key', () => {
      config.S3_ENABLE_PATH_STYLE = true;
      const url = 'https://example.com/my-bucket/path/to/file.jpg';

      const result = fileService.getKeyFromFullUrl(url);

      expect(result).toBe('path/to/file.jpg');
      config.S3_ENABLE_PATH_STYLE = false; // reset
    });

    it('当S3_ENABLE_PATH_STYLE为true但缺少bucket名称时应该返回pathname', () => {
      config.S3_ENABLE_PATH_STYLE = true;
      config.S3_BUCKET = '';
      const url = 'https://example.com/path/to/file.jpg';

      const result = fileService.getKeyFromFullUrl(url);

      expect(result).toBe('path/to/file.jpg');
      config.S3_ENABLE_PATH_STYLE = false; // reset
      config.S3_BUCKET = 'my-bucket'; // reset
    });

    it('当URL格式不正确时应该返回原始字符串', () => {
      const invalidUrl = 'not-a-valid-url';

      const result = fileService.getKeyFromFullUrl(invalidUrl);

      expect(result).toBe('not-a-valid-url');
    });

    it('应该处理根路径文件', () => {
      config.S3_ENABLE_PATH_STYLE = false;
      const url = 'https://example.com/file.jpg';

      const result = fileService.getKeyFromFullUrl(url);

      expect(result).toBe('file.jpg');
    });

    it('当path-style URL路径格式不符合预期时应该使用fallback', () => {
      config.S3_ENABLE_PATH_STYLE = true;
      const url = 'https://example.com/unexpected/path/file.jpg';

      const result = fileService.getKeyFromFullUrl(url);

      expect(result).toBe('unexpected/path/file.jpg');
      config.S3_ENABLE_PATH_STYLE = false; // reset
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
