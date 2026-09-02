import { MAX_UPLOAD_FILE_SIZE, UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE } from '@lobechat/const';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileEnv } from '@/envs/file';
import { lambdaClient } from '@/libs/trpc/client';

import { hashFile, UPLOAD_NETWORK_ERROR, uploadService } from '../upload';

const { mockHashHex, mockHashUpdate } = vi.hoisted(() => ({
  mockHashHex: vi.fn(() => 'streamed-hash'),
  mockHashUpdate: vi.fn(),
}));

vi.mock('@lobechat/model-runtime', () => ({
  parseDataUri: vi.fn(),
}));

vi.mock('@lobechat/utils', () => ({
  uuid: () => 'mock-uuid',
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    upload: {
      abortS3MultipartUpload: {
        mutate: vi.fn(),
      },
      completeS3MultipartUpload: {
        mutate: vi.fn(),
      },
      createS3MultipartUpload: {
        mutate: vi.fn(),
      },
      createS3MultipartUploadPartUrl: {
        mutate: vi.fn(),
      },
      createS3PreSignedUrl: {
        mutate: vi.fn(),
      },
    },
  },
}));

vi.mock('js-sha256', () => ({
  sha256: {
    create: vi.fn(() => ({ hex: mockHashHex, update: mockHashUpdate })),
  },
}));

describe('UploadService', () => {
  const mockFile = new File(['test'], 'test.png', { type: 'image/png' });
  const mockPreSignUrl = 'https://example.com/presign';

  beforeAll(() => {
    Object.defineProperty(File.prototype, 'stream', {
      configurable: true,
      value: function () {
        return new ReadableStream<Uint8Array>({
          type: 'bytes',
          start(controller) {
            const byteController = controller as ReadableByteStreamController;
            byteController.enqueue(new Uint8Array([1, 2, 3]));
            byteController.close();
          },
        });
      },
      writable: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock Date.now
    vi.spyOn(Date, 'now').mockImplementation(() => 3600000); // 1 hour in milliseconds
  });

  describe('uploadFileToS3', () => {
    beforeEach(() => {
      // Mock XMLHttpRequest for server upload
      const xhrMock = {
        addEventListener: vi.fn((event, handler) => {
          if (event === 'load') {
            setTimeout(() => handler({ target: { status: 200 } }), 0);
          }
        }),
        getResponseHeader: vi.fn(() => 'etag-value'),
        open: vi.fn(),
        send: vi.fn(),
        setRequestHeader: vi.fn(),
        status: 200,
        upload: {
          addEventListener: vi.fn(),
        },
      };
      global.XMLHttpRequest = vi.fn(() => xhrMock) as any;

      // Mock createS3PreSignedUrl
      vi.mocked(lambdaClient.upload.createS3PreSignedUrl.mutate).mockResolvedValue(mockPreSignUrl);
    });

    it('should upload to server S3 in non-desktop mode', async () => {
      const result = await uploadService.uploadFileToS3(mockFile, {});

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        date: '1',
        dirname: `${fileEnv.NEXT_PUBLIC_S3_FILE_PATH}/1`,
        filename: 'mock-uuid.png',
        path: `${fileEnv.NEXT_PUBLIC_S3_FILE_PATH}/1/mock-uuid.png`,
      });
    });

    it('should use custom pathname when provided', async () => {
      const customPath = 'custom/path/file.png';
      const result = await uploadService.uploadFileToS3(mockFile, {
        pathname: customPath,
      });

      expect(result.success).toBe(true);
      expect(result.data.path).toBe(customPath);
    });

    it('should reject files larger than the database size range before uploading', async () => {
      const oversizedFile = new File(['test'], 'huge.bin', {
        type: 'application/octet-stream',
      });
      Object.defineProperty(oversizedFile, 'size', {
        configurable: true,
        value: MAX_UPLOAD_FILE_SIZE + 1,
      });

      await expect(uploadService.uploadFileToS3(oversizedFile, {})).rejects.toThrow(
        UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE,
      );
      expect(lambdaClient.upload.createS3PreSignedUrl.mutate).not.toHaveBeenCalled();
      expect(lambdaClient.upload.createS3MultipartUpload.mutate).not.toHaveBeenCalled();
    });

    it('should use custom directory when provided', async () => {
      const result = await uploadService.uploadFileToS3(mockFile, {
        directory: 'custom/dir',
      });

      expect(result.success).toBe(true);
      expect(result.data.dirname).toContain('custom/dir');
    });
  });

  describe('uploadBase64ToS3', () => {
    beforeEach(() => {
      // Mock XMLHttpRequest for server upload
      const xhrMock = {
        addEventListener: vi.fn((event, handler) => {
          if (event === 'load') {
            setTimeout(() => handler({ target: { status: 200 } }), 0);
          }
        }),
        open: vi.fn(),
        send: vi.fn(),
        setRequestHeader: vi.fn(),
        status: 200,
        upload: {
          addEventListener: vi.fn(),
        },
      };
      global.XMLHttpRequest = vi.fn(() => xhrMock) as any;

      // Mock createS3PreSignedUrl
      vi.mocked(lambdaClient.upload.createS3PreSignedUrl.mutate).mockResolvedValue(mockPreSignUrl);
    });

    it('should upload base64 data successfully', async () => {
      const { parseDataUri } = await import('@lobechat/model-runtime');
      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: 'dGVzdA==', // "test" in base64
        mimeType: 'image/png',
        type: 'base64',
      });

      const base64Data = 'data:image/png;base64,dGVzdA==';
      const result = await uploadService.uploadBase64ToS3(base64Data);

      expect(result).toMatchObject({
        fileType: 'image/png',
        hash: expect.any(String),
        metadata: expect.objectContaining({
          path: expect.stringContaining(fileEnv.NEXT_PUBLIC_S3_FILE_PATH || ''),
        }),
        size: expect.any(Number),
      });
    });

    it('should throw error for invalid base64 data', async () => {
      const { parseDataUri } = await import('@lobechat/model-runtime');
      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: null,
        mimeType: null,
        type: 'url',
      });

      const invalidBase64 = 'not-a-base64-string';

      await expect(uploadService.uploadBase64ToS3(invalidBase64)).rejects.toThrow(
        'Invalid base64 data for image',
      );
    });

    it('should use custom filename when provided', async () => {
      const { parseDataUri } = await import('@lobechat/model-runtime');
      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: 'dGVzdA==',
        mimeType: 'image/png',
        type: 'base64',
      });

      const base64Data = 'data:image/png;base64,dGVzdA==';
      const result = await uploadService.uploadBase64ToS3(base64Data, {
        filename: 'custom-image',
      });

      // The filename will be regenerated with UUID, but should keep the extension
      expect(result.metadata.filename).toMatch(/^mock-uuid\.png$/);
    });
  });

  describe('uploadDataToS3', () => {
    beforeEach(() => {
      // Mock XMLHttpRequest for server upload
      const xhrMock = {
        addEventListener: vi.fn((event, handler) => {
          if (event === 'load') {
            setTimeout(() => handler({ target: { status: 200 } }), 0);
          }
        }),
        open: vi.fn(),
        send: vi.fn(),
        setRequestHeader: vi.fn(),
        status: 200,
        upload: {
          addEventListener: vi.fn(),
        },
      };
      global.XMLHttpRequest = vi.fn(() => xhrMock) as any;

      // Mock createS3PreSignedUrl
      vi.mocked(lambdaClient.upload.createS3PreSignedUrl.mutate).mockResolvedValue(mockPreSignUrl);
    });

    it('should upload JSON data successfully', async () => {
      const data = { key: 'value', number: 123 };
      const result = await uploadService.uploadDataToS3(data);

      expect(result.success).toBe(true);
      // The filename will be regenerated with UUID
      expect(result.data.filename).toMatch(/^mock-uuid\.json$/);
    });

    it('should use custom filename when provided', async () => {
      const data = { test: true };
      const result = await uploadService.uploadDataToS3(data, {
        filename: 'custom.json',
      });

      expect(result.success).toBe(true);
      // The filename will be regenerated with UUID, keeping the extension
      expect(result.data.filename).toMatch(/^mock-uuid\.json$/);
    });
  });

  describe('uploadToServerS3', () => {
    beforeEach(() => {
      // Mock XMLHttpRequest
      const xhrMock = {
        addEventListener: vi.fn(),
        getResponseHeader: vi.fn(() => 'etag-value'),
        open: vi.fn(),
        send: vi.fn(),
        setRequestHeader: vi.fn(),
        status: 200,
        upload: {
          addEventListener: vi.fn(),
        },
      };
      global.XMLHttpRequest = vi.fn(() => xhrMock) as any;

      // Mock createS3PreSignedUrl
      vi.mocked(lambdaClient.upload.createS3PreSignedUrl.mutate).mockResolvedValue(mockPreSignUrl);
    });

    it('should upload file successfully with progress', async () => {
      const onProgress = vi.fn();
      const xhr = new XMLHttpRequest();

      // Simulate successful upload
      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'load') {
          // @ts-expect-error - mock implementation
          handler({ target: { status: 200 } });
        }
      });

      const result = await uploadService.uploadToServerS3(mockFile, { onProgress });

      expect(result).toEqual({
        date: '1',
        dirname: `${fileEnv.NEXT_PUBLIC_S3_FILE_PATH}/1`,
        filename: 'mock-uuid.png',
        path: `${fileEnv.NEXT_PUBLIC_S3_FILE_PATH}/1/mock-uuid.png`,
      });
      expect(xhr.send).toHaveBeenCalledWith(mockFile);
    });

    it('should report progress during upload', async () => {
      const onProgress = vi.fn();
      const xhr = new XMLHttpRequest();

      // Simulate progress events
      vi.spyOn(xhr.upload, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'progress') {
          // @ts-expect-error - mock implementation
          handler({
            lengthComputable: true,
            loaded: 500,
            total: 1000,
          });
        }
      });

      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'load') {
          // @ts-expect-error - mock implementation
          handler({ target: { status: 200 } });
        }
      });

      await uploadService.uploadToServerS3(mockFile, { onProgress });

      expect(onProgress).toHaveBeenCalledWith(
        'uploading',
        expect.objectContaining({
          progress: expect.any(Number),
          restTime: expect.any(Number),
          speed: expect.any(Number),
        }),
      );
    });

    it('should handle network error', async () => {
      const xhr = new XMLHttpRequest();

      // Simulate network error
      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'error') {
          Object.assign(xhr, { status: 0 });
          // @ts-expect-error - mock implementation
          handler({});
        }
      });

      await expect(uploadService.uploadToServerS3(mockFile, {})).rejects.toBe(UPLOAD_NETWORK_ERROR);
    });

    it('should handle upload error', async () => {
      const xhr = new XMLHttpRequest();

      // Simulate upload error
      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'load') {
          Object.assign(xhr, { status: 400, statusText: 'Bad Request' });

          // @ts-expect-error - mock implementation
          handler({});
        }
      });

      await expect(uploadService.uploadToServerS3(mockFile, {})).rejects.toBe('Bad Request');
    });

    it('should use custom directory when provided', async () => {
      const xhr = new XMLHttpRequest();
      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'load') {
          // @ts-expect-error - mock implementation
          handler({ target: { status: 200 } });
        }
      });

      const result = await uploadService.uploadToServerS3(mockFile, {
        directory: 'custom/dir',
      });

      expect(result.dirname).toContain('custom/dir');
    });

    it('should use custom pathname when provided', async () => {
      const xhr = new XMLHttpRequest();
      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'load') {
          // @ts-expect-error - mock implementation
          handler({ target: { status: 200 } });
        }
      });

      const customPath = 'custom/path/file.png';
      const result = await uploadService.uploadToServerS3(mockFile, {
        pathname: customPath,
      });

      expect(result.path).toBe(customPath);
    });

    it('should upload large files as sequential S3 parts without buffering the whole file', async () => {
      const largeFile = new File(['small fixture'], 'large.bin', {
        type: 'application/octet-stream',
      });
      Object.defineProperty(largeFile, 'size', { value: 64 * 1024 * 1024 + 1 });
      const slice = vi
        .spyOn(largeFile, 'slice')
        .mockImplementation(() => new Blob(['part'], { type: largeFile.type }));
      const arrayBuffer = vi.fn();
      Object.defineProperty(largeFile, 'arrayBuffer', { value: arrayBuffer });

      vi.mocked(lambdaClient.upload.createS3MultipartUpload.mutate).mockResolvedValue({
        uploadId: 'upload-1',
      });
      vi.mocked(lambdaClient.upload.createS3MultipartUploadPartUrl.mutate).mockResolvedValue(
        'https://example.com/part',
      );
      vi.mocked(lambdaClient.upload.completeS3MultipartUpload.mutate).mockResolvedValue({
        success: true,
      });

      const xhr = new XMLHttpRequest();
      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'load') {
          // @ts-expect-error test event only needs to trigger the registered handler
          handler({});
        }
      });

      await uploadService.uploadToServerS3(largeFile, {});

      expect(lambdaClient.upload.createS3PreSignedUrl.mutate).not.toHaveBeenCalled();
      expect(lambdaClient.upload.createS3MultipartUploadPartUrl.mutate).toHaveBeenCalledTimes(3);
      expect(slice).toHaveBeenCalledTimes(3);
      expect(xhr.send).toHaveBeenCalledTimes(3);
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(lambdaClient.upload.completeS3MultipartUpload.mutate).toHaveBeenCalledWith({
        partCount: 3,
        parts: [
          { etag: 'etag-value', partNumber: 1 },
          { etag: 'etag-value', partNumber: 2 },
          { etag: 'etag-value', partNumber: 3 },
        ],
        pathname: expect.stringContaining('mock-uuid.bin'),
        uploadId: 'upload-1',
      });
      expect(lambdaClient.upload.abortS3MultipartUpload.mutate).not.toHaveBeenCalled();
    });

    it('should abort the S3 multipart upload when a part cannot be signed', async () => {
      const largeFile = new File(['small fixture'], 'large.bin');
      Object.defineProperty(largeFile, 'size', { value: 64 * 1024 * 1024 });
      vi.mocked(lambdaClient.upload.createS3MultipartUpload.mutate).mockResolvedValue({
        uploadId: 'upload-1',
      });
      vi.mocked(lambdaClient.upload.createS3MultipartUploadPartUrl.mutate).mockRejectedValue(
        new Error('signing failed'),
      );
      vi.mocked(lambdaClient.upload.abortS3MultipartUpload.mutate).mockResolvedValue({
        success: true,
      });

      await expect(uploadService.uploadToServerS3(largeFile, {})).rejects.toThrow('signing failed');

      expect(lambdaClient.upload.abortS3MultipartUpload.mutate).toHaveBeenCalledWith({
        pathname: expect.any(String),
        uploadId: 'upload-1',
      });
      expect(lambdaClient.upload.completeS3MultipartUpload.mutate).not.toHaveBeenCalled();
    });
  });

  it('should calculate a SHA-256 hash with a reusable BYOB buffer', async () => {
    const file = new File(['fixture'], 'fixture.bin');
    const arrayBuffer = vi.fn();
    Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });
    Object.defineProperty(file, 'stream', {
      value: () =>
        new ReadableStream<Uint8Array>({
          type: 'bytes',
          start(controller) {
            const byteController = controller as ReadableByteStreamController;
            byteController.enqueue(new Uint8Array([1, 2]));
            byteController.enqueue(new Uint8Array([3, 4]));
            byteController.close();
          },
        }),
    });

    await expect(hashFile(file)).resolves.toBe('streamed-hash');
    expect(mockHashUpdate).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
