// @vitest-environment node
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileS3, S3 } from './index';

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3');
vi.mock('@aws-sdk/s3-request-presigner');

// Mock environment variables
vi.mock('@/envs/file', () => ({
  fileEnv: {
    S3_ACCESS_KEY_ID: 'test-access-key',
    S3_BUCKET: 'test-bucket',
    S3_ENABLE_PATH_STYLE: false,
    S3_ENDPOINT: 'https://s3.amazonaws.com',
    S3_PREVIEW_URL_EXPIRE_IN: 7200,
    S3_REGION: 'us-east-1',
    S3_SECRET_ACCESS_KEY: 'test-secret-key',
    S3_SET_ACL: true,
  },
}));

// Mock utilities
vi.mock('@/utils/url', () => ({
  inferContentTypeFromImageUrl: vi.fn((key: string) => {
    if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
    if (key.endsWith('.png')) return 'image/png';
    if (key.endsWith('.gif')) return 'image/gif';
    return 'application/octet-stream';
  }),
}));

describe('S3', () => {
  let mockS3ClientSend: ReturnType<typeof vi.fn>;
  let mockGetSignedUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup S3Client mock
    mockS3ClientSend = vi.fn();
    (S3Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      send: mockS3ClientSend,
    }));

    // Setup getSignedUrl mock
    mockGetSignedUrl = vi.fn().mockResolvedValue('https://presigned-url.example.com');
    (getSignedUrl as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockGetSignedUrl);
  });

  describe('constructor', () => {
    it('should initialize S3 client with correct configuration', () => {
      const testFileEnv = {
        S3_ACCESS_KEY_ID: 'test-access-key',
        S3_BUCKET: 'test-bucket',
        S3_ENABLE_PATH_STYLE: false,
        S3_ENDPOINT: 'https://s3.amazonaws.com',
        S3_PREVIEW_URL_EXPIRE_IN: 7200,
        S3_REGION: 'us-east-1',
        S3_SECRET_ACCESS_KEY: 'test-secret-key',
        S3_SET_ACL: true,
      };

      new S3(
        testFileEnv.S3_ACCESS_KEY_ID,
        testFileEnv.S3_SECRET_ACCESS_KEY,
        testFileEnv.S3_ENDPOINT,
        {
          bucket: testFileEnv.S3_BUCKET,
          forcePathStyle: testFileEnv.S3_ENABLE_PATH_STYLE,
          region: testFileEnv.S3_REGION,
          setAcl: testFileEnv.S3_SET_ACL,
        },
      );

      expect(S3Client).toHaveBeenCalledWith({
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
        endpoint: 'https://s3.amazonaws.com',
        forcePathStyle: false,
        region: 'us-east-1',
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    });

    it('should use default region when S3_REGION is not set', () => {
      const testEnvWithoutRegion = {
        S3_ACCESS_KEY_ID: 'test-access-key',
        S3_BUCKET: 'test-bucket',
        S3_ENABLE_PATH_STYLE: false,
        S3_ENDPOINT: 'https://s3.amazonaws.com',
        S3_PREVIEW_URL_EXPIRE_IN: 7200,
        S3_REGION: '',
        S3_SECRET_ACCESS_KEY: 'test-secret-key',
        S3_SET_ACL: true,
      };

      new S3(
        testEnvWithoutRegion.S3_ACCESS_KEY_ID,
        testEnvWithoutRegion.S3_SECRET_ACCESS_KEY,
        testEnvWithoutRegion.S3_ENDPOINT,
        {
          bucket: testEnvWithoutRegion.S3_BUCKET,
          forcePathStyle: testEnvWithoutRegion.S3_ENABLE_PATH_STYLE,
          region: testEnvWithoutRegion.S3_REGION,
          setAcl: testEnvWithoutRegion.S3_SET_ACL,
        },
      );

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'us-east-1',
        }),
      );
    });
  });
});

describe('FileS3', () => {
  let mockS3ClientSend: ReturnType<typeof vi.fn>;
  let mockGetSignedUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup S3Client mock
    mockS3ClientSend = vi.fn();
    (S3Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      send: mockS3ClientSend,
    }));

    // Setup getSignedUrl mock
    mockGetSignedUrl = vi.fn().mockResolvedValue('https://presigned-url.example.com');
    (getSignedUrl as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockGetSignedUrl);
  });

  describe('constructor', () => {
    it('should initialize S3 client with correct configuration', () => {
      new FileS3();

      expect(S3Client).toHaveBeenCalledWith({
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
        endpoint: 'https://s3.amazonaws.com',
        forcePathStyle: false,
        region: 'us-east-1',
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    });

    it('should use default region when S3_REGION is not set', () => {
      vi.doMock('@/envs/file', () => ({
        fileEnv: {
          S3_ACCESS_KEY_ID: 'test-access-key',
          S3_BUCKET: 'test-bucket',
          S3_ENABLE_PATH_STYLE: false,
          S3_ENDPOINT: 'https://s3.amazonaws.com',
          S3_PREVIEW_URL_EXPIRE_IN: 7200,
          S3_REGION: '',
          S3_SECRET_ACCESS_KEY: 'test-secret-key',
          S3_SET_ACL: true,
        },
      }));

      new FileS3();

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'us-east-1',
        }),
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete a file with the correct parameters', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({});

      await s3.deleteFile('test-key.txt');

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-key.txt',
      });
      expect(mockS3ClientSend).toHaveBeenCalled();
    });

    it('should handle deletion errors', async () => {
      const s3 = new FileS3();
      const error = new Error('Delete failed');
      mockS3ClientSend.mockRejectedValue(error);

      await expect(s3.deleteFile('test-key.txt')).rejects.toThrow('Delete failed');
    });
  });

  describe('deleteFiles', () => {
    it('should delete multiple files with correct parameters', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({});

      const keys = ['file1.txt', 'file2.txt', 'file3.txt'];
      await s3.deleteFiles(keys);

      expect(DeleteObjectsCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Delete: {
          Objects: [{ Key: 'file1.txt' }, { Key: 'file2.txt' }, { Key: 'file3.txt' }],
        },
      });
      expect(mockS3ClientSend).toHaveBeenCalled();
    });

    it('should handle empty array', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({});

      await s3.deleteFiles([]);

      expect(DeleteObjectsCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Delete: {
          Objects: [],
        },
      });
    });
  });

  describe('getFileContent', () => {
    it('should retrieve file content as string', async () => {
      const s3 = new FileS3();
      const mockContent = 'Hello, World!';
      mockS3ClientSend.mockResolvedValue({
        Body: {
          transformToString: vi.fn().mockResolvedValue(mockContent),
        },
      });

      const result = await s3.getFileContent('test-file.txt');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-file.txt',
      });
      expect(result).toBe(mockContent);
    });

    it('should throw error when response body is missing', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({
        Body: undefined,
      });

      await expect(s3.getFileContent('test-file.txt')).rejects.toThrow(
        'No body in response with test-file.txt',
      );
    });
  });

  describe('getFileByteArray', () => {
    it('should retrieve file content as byte array', async () => {
      const s3 = new FileS3();
      const mockBytes = new Uint8Array([1, 2, 3, 4, 5]);
      mockS3ClientSend.mockResolvedValue({
        Body: {
          transformToByteArray: vi.fn().mockResolvedValue(mockBytes),
        },
      });

      const result = await s3.getFileByteArray('test-file.bin');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-file.bin',
      });
      expect(result).toEqual(mockBytes);
    });

    it('should throw error when response body is missing', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({
        Body: undefined,
      });

      await expect(s3.getFileByteArray('test-file.bin')).rejects.toThrow(
        'No body in response with test-file.bin',
      );
    });
  });

  describe('getFileMetadata', () => {
    it('should retrieve file metadata with content length and type', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({
        ContentLength: 1024,
        ContentType: 'image/png',
      });

      const result = await s3.getFileMetadata('test-file.png');

      expect(HeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-file.png',
      });
      expect(result).toEqual({
        contentLength: 1024,
        contentType: 'image/png',
      });
    });

    it('should return 0 for content length when not provided', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({
        ContentType: 'application/octet-stream',
      });

      const result = await s3.getFileMetadata('test-file.bin');

      expect(result).toEqual({
        contentLength: 0,
        contentType: 'application/octet-stream',
      });
    });

    it('should handle missing content type', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({
        ContentLength: 2048,
      });

      const result = await s3.getFileMetadata('test-file.bin');

      expect(result).toEqual({
        contentLength: 2048,
        contentType: undefined,
      });
    });

    it('should handle S3 errors', async () => {
      const s3 = new FileS3();
      const error = new Error('File not found');
      mockS3ClientSend.mockRejectedValue(error);

      await expect(s3.getFileMetadata('non-existent-file.txt')).rejects.toThrow('File not found');
    });
  });

  describe('createPreSignedUrl', () => {
    it('should create presigned URL for upload with ACL', async () => {
      const s3 = new FileS3();

      const result = await s3.createPreSignedUrl('upload-file.txt');

      expect(PutObjectCommand).toHaveBeenCalledWith({
        ACL: 'public-read',
        Bucket: 'test-bucket',
        Key: 'upload-file.txt',
      });
      expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        expiresIn: 3600,
      });
      expect(result).toBe('https://presigned-url.example.com');
    });
  });

  describe('createPreSignedUrlForPreview', () => {
    it('should create presigned URL for preview with default expiration', async () => {
      const s3 = new FileS3();

      const result = await s3.createPreSignedUrlForPreview('preview-file.jpg');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'preview-file.jpg',
      });
      expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        expiresIn: 7200,
      });
      expect(result).toBe('https://presigned-url.example.com');
    });

    it('should create presigned URL for preview with custom expiration', async () => {
      const s3 = new FileS3();

      await s3.createPreSignedUrlForPreview('preview-file.jpg', 1800);

      expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        expiresIn: 1800,
      });
    });
  });

  describe('uploadBuffer', () => {
    it('should upload buffer with correct parameters', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({});

      const buffer = Buffer.from('test data');
      await s3.uploadBuffer('test-file.bin', buffer, 'application/octet-stream');

      expect(PutObjectCommand).toHaveBeenCalledWith({
        ACL: 'public-read',
        Body: buffer,
        Bucket: 'test-bucket',
        ContentType: 'application/octet-stream',
        Key: 'test-file.bin',
      });
      expect(mockS3ClientSend).toHaveBeenCalled();
    });

    it('should upload buffer without content type', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({});

      const buffer = Buffer.from('test data');
      await s3.uploadBuffer('test-file.bin', buffer);

      expect(PutObjectCommand).toHaveBeenCalledWith({
        ACL: 'public-read',
        Body: buffer,
        Bucket: 'test-bucket',
        ContentType: undefined,
        Key: 'test-file.bin',
      });
    });
  });

  describe('uploadContent', () => {
    it('should upload string content with correct parameters', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({});

      const content = 'Hello, World!';
      await s3.uploadContent('test-file.txt', content);

      expect(PutObjectCommand).toHaveBeenCalledWith({
        ACL: 'public-read',
        Body: content,
        Bucket: 'test-bucket',
        Key: 'test-file.txt',
      });
      expect(mockS3ClientSend).toHaveBeenCalled();
    });

    it('should handle empty content', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({});

      await s3.uploadContent('empty.txt', '');

      expect(PutObjectCommand).toHaveBeenCalledWith({
        ACL: 'public-read',
        Body: '',
        Bucket: 'test-bucket',
        Key: 'empty.txt',
      });
    });
  });

  describe('uploadMedia', () => {
    it('should upload media with correct content type and cache control for JPEG', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({});

      const buffer = Buffer.from('fake image data');
      await s3.uploadMedia('image.jpg', buffer);

      expect(PutObjectCommand).toHaveBeenCalledWith({
        ACL: 'public-read',
        Body: buffer,
        Bucket: 'test-bucket',
        CacheControl: expect.stringContaining('public, max-age='),
        ContentType: 'image/jpeg',
        Key: 'image.jpg',
      });
      expect(mockS3ClientSend).toHaveBeenCalled();
    });

    it('should upload media with correct content type for PNG', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({});

      const buffer = Buffer.from('fake image data');
      await s3.uploadMedia('image.png', buffer);

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentType: 'image/png',
          Key: 'image.png',
        }),
      );
    });

    it('should upload media with correct content type for GIF', async () => {
      const s3 = new FileS3();
      mockS3ClientSend.mockResolvedValue({});

      const buffer = Buffer.from('fake image data');
      await s3.uploadMedia('animation.gif', buffer);

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentType: 'image/gif',
          Key: 'animation.gif',
        }),
      );
    });
  });
});
