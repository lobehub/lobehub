import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskStatus, AsyncTaskType } from '@/types/asyncTask';

// Use vi.hoisted for variables used in vi.mock factory
const {
  mockServerDB,
  mockGetKeyFromFullUrl,
  mockGetFullFileUrl,
  mockAsyncTaskModelUpdate,
  mockChargeBeforeGenerate,
  mockCreateAsyncCaller,
} = vi.hoisted(() => ({
  mockServerDB: {
    transaction: vi.fn(),
  },
  mockGetKeyFromFullUrl: vi.fn(),
  mockGetFullFileUrl: vi.fn(),
  mockAsyncTaskModelUpdate: vi.fn(),
  mockChargeBeforeGenerate: vi.fn(),
  mockCreateAsyncCaller: vi.fn(),
}));

// Mock debug
vi.mock('debug', () => ({
  default: () => () => {},
}));

// Mock auth related
vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn(() => ({})),
}));

// Mock database adaptor
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => mockServerDB),
}));

// Mock FileService
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({
    getKeyFromFullUrl: mockGetKeyFromFullUrl,
    getFullFileUrl: mockGetFullFileUrl,
  })),
}));

// Mock AsyncTaskModel
vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    update: mockAsyncTaskModelUpdate,
  })),
}));

// Mock chargeBeforeGenerate
vi.mock('@/business/server/image-generation/chargeBeforeGenerate', () => ({
  chargeBeforeGenerate: (params: any) => mockChargeBeforeGenerate(params),
}));

// Mock async caller
vi.mock('@/server/routers/async/caller', () => ({
  createAsyncCaller: mockCreateAsyncCaller,
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => args),
  eq: vi.fn((a, b) => ({ a, b })),
}));

// Mock database schemas
vi.mock('@/database/schemas', () => ({
  asyncTasks: { id: 'asyncTasks.id', userId: 'asyncTasks.userId' },
  generationBatches: { id: 'generationBatches.id' },
  generations: { id: 'generations.id', userId: 'generations.userId' },
}));

// Mock seed generator
vi.mock('@/utils/number', () => ({
  generateUniqueSeeds: vi.fn((count: number) => Array.from({ length: count }, (_, i) => 1000 + i)),
}));

import { imageRouter } from './index';

describe('imageRouter', () => {
  const mockUserId = 'test-user-id';
  const mockAsyncCallerCreateImage = vi.fn();

  const createMockCtx = (overrides = {}) => ({
    userId: mockUserId,
    authorizationHeader: 'mock-auth-header',
    ...overrides,
  });

  const createDefaultInput = (overrides = {}) => ({
    generationTopicId: 'topic-1',
    imageNum: 2,
    model: 'stable-diffusion',
    params: {
      prompt: 'a beautiful sunset',
      width: 512,
      height: 512,
    },
    provider: 'test-provider',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockChargeBeforeGenerate.mockResolvedValue(undefined);
    mockGetKeyFromFullUrl.mockResolvedValue(null);
    mockGetFullFileUrl.mockResolvedValue(null);

    // Setup default transaction mock
    const mockBatch = {
      id: 'batch-1',
      generationTopicId: 'topic-1',
      model: 'stable-diffusion',
      provider: 'test-provider',
      config: {},
      userId: mockUserId,
    };

    const mockGenerations = [
      { id: 'gen-1', generationBatchId: 'batch-1', seed: 1000, userId: mockUserId },
      { id: 'gen-2', generationBatchId: 'batch-1', seed: 1001, userId: mockUserId },
    ];

    const mockAsyncTasks = [
      { id: 'task-1', status: AsyncTaskStatus.Pending, type: AsyncTaskType.ImageGeneration },
      { id: 'task-2', status: AsyncTaskStatus.Pending, type: AsyncTaskType.ImageGeneration },
    ];

    let insertCallCount = 0;
    mockServerDB.transaction.mockImplementation(async (callback) => {
      insertCallCount = 0;
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockImplementation(() => {
              insertCallCount++;
              if (insertCallCount === 1) return [mockBatch];
              if (insertCallCount === 2) return mockGenerations;
              // For async tasks, return one at a time
              const taskIndex = insertCallCount - 3;
              return [mockAsyncTasks[taskIndex] || mockAsyncTasks[0]];
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };

      return callback(tx);
    });

    mockCreateAsyncCaller.mockResolvedValue({
      image: {
        createImage: mockAsyncCallerCreateImage,
      },
    });
  });

  describe('createImage', () => {
    it('should create image generation batch and generations successfully', async () => {
      const ctx = createMockCtx();
      const input = createDefaultInput();

      const caller = imageRouter.createCaller(ctx);
      const result = await caller.createImage(input);

      expect(result.success).toBe(true);
      expect(result.data.batch).toBeDefined();
      expect(result.data.batch.id).toBe('batch-1');
      expect(result.data.generations).toHaveLength(2);
      expect(mockServerDB.transaction).toHaveBeenCalled();
    });

    it('should convert imageUrls to S3 keys for database storage', async () => {
      mockGetKeyFromFullUrl
        .mockResolvedValueOnce('files/image1.jpg')
        .mockResolvedValueOnce('files/image2.jpg');

      const ctx = createMockCtx();
      const input = createDefaultInput({
        params: {
          prompt: 'test prompt',
          imageUrls: [
            'https://s3.amazonaws.com/bucket/files/image1.jpg',
            'https://s3.amazonaws.com/bucket/files/image2.jpg',
          ],
        },
      });

      const caller = imageRouter.createCaller(ctx);
      await caller.createImage(input);

      expect(mockGetKeyFromFullUrl).toHaveBeenCalledTimes(2);
      expect(mockGetKeyFromFullUrl).toHaveBeenCalledWith(
        'https://s3.amazonaws.com/bucket/files/image1.jpg',
      );
      expect(mockGetKeyFromFullUrl).toHaveBeenCalledWith(
        'https://s3.amazonaws.com/bucket/files/image2.jpg',
      );
    });

    it('should convert single imageUrl to S3 key for database storage', async () => {
      mockGetKeyFromFullUrl.mockResolvedValue('files/single-image.jpg');

      const ctx = createMockCtx();
      const input = createDefaultInput({
        params: {
          prompt: 'test prompt',
          imageUrl: 'https://s3.amazonaws.com/bucket/files/single-image.jpg',
        },
      });

      const caller = imageRouter.createCaller(ctx);
      await caller.createImage(input);

      expect(mockGetKeyFromFullUrl).toHaveBeenCalledWith(
        'https://s3.amazonaws.com/bucket/files/single-image.jpg',
      );
    });

    it('should handle failed URL to key conversion gracefully for imageUrls', async () => {
      mockGetKeyFromFullUrl.mockResolvedValue(null);

      const ctx = createMockCtx();
      const input = createDefaultInput({
        params: {
          prompt: 'test prompt',
          imageUrls: ['https://example.com/image.jpg'],
        },
      });

      const caller = imageRouter.createCaller(ctx);
      const result = await caller.createImage(input);

      // Should still succeed, just with empty imageUrls in config
      expect(result.success).toBe(true);
    });

    it('should throw error when imageUrls conversion fails and URLs remain', async () => {
      mockGetKeyFromFullUrl.mockRejectedValue(new Error('Conversion failed'));

      const ctx = createMockCtx();
      const input = createDefaultInput({
        params: {
          prompt: 'test prompt',
          imageUrls: ['https://example.com/image.jpg'],
        },
      });

      const caller = imageRouter.createCaller(ctx);

      // When conversion fails, the original URL is kept but validateNoUrlsInConfig
      // will detect it and throw an error to prevent storing URLs in database
      await expect(caller.createImage(input)).rejects.toThrow(
        'Invalid configuration: Found full URL instead of key',
      );
    });

    it('should throw error when single imageUrl conversion fails and URL remains', async () => {
      mockGetKeyFromFullUrl.mockRejectedValue(new Error('Conversion failed'));

      const ctx = createMockCtx();
      const input = createDefaultInput({
        params: {
          prompt: 'test prompt',
          imageUrl: 'https://example.com/image.jpg',
        },
      });

      const caller = imageRouter.createCaller(ctx);

      // When conversion fails, the original URL is kept but validateNoUrlsInConfig
      // will detect it and throw an error to prevent storing URLs in database
      await expect(caller.createImage(input)).rejects.toThrow(
        'Invalid configuration: Found full URL instead of key',
      );
    });

    it('should return charge result when chargeBeforeGenerate returns a value', async () => {
      const chargeResult = {
        success: true as const,
        data: {
          batch: { id: 'charged-batch' },
          generations: [{ id: 'charged-gen' }],
        },
      };
      mockChargeBeforeGenerate.mockResolvedValue(chargeResult);

      const ctx = createMockCtx();
      const input = createDefaultInput();

      const caller = imageRouter.createCaller(ctx);
      const result = await caller.createImage(input);

      expect(result).toEqual(chargeResult);
      // Should not proceed with database transaction
      expect(mockServerDB.transaction).not.toHaveBeenCalled();
    });

    it('should call chargeBeforeGenerate with correct parameters', async () => {
      const ctx = createMockCtx();
      const input = createDefaultInput();

      const caller = imageRouter.createCaller(ctx);
      await caller.createImage(input);

      expect(mockChargeBeforeGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          generationTopicId: 'topic-1',
          imageNum: 2,
          model: 'stable-diffusion',
          provider: 'test-provider',
          userId: mockUserId,
        }),
      );
    });

    it('should trigger async image generation tasks', async () => {
      const ctx = createMockCtx();
      const input = createDefaultInput();

      const caller = imageRouter.createCaller(ctx);
      await caller.createImage(input);

      expect(mockCreateAsyncCaller).toHaveBeenCalledWith({ userId: mockUserId });
    });

    it('should handle async caller creation failure', async () => {
      mockCreateAsyncCaller.mockRejectedValue(new Error('Caller creation failed'));

      const ctx = createMockCtx();
      const input = createDefaultInput();

      const caller = imageRouter.createCaller(ctx);
      const result = await caller.createImage(input);

      // Should still return success as the database records were created
      expect(result.success).toBe(true);
      // Should update async task status to error
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalled();
    });

    it('should update all task statuses to error when async processing fails', async () => {
      mockCreateAsyncCaller.mockRejectedValue(new Error('Processing failed'));

      const ctx = createMockCtx();
      const input = createDefaultInput();

      const caller = imageRouter.createCaller(ctx);
      await caller.createImage(input);

      // Should update both tasks to error status
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledTimes(2);
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: AsyncTaskStatus.Error,
        }),
      );
    });

    it('should generate unique seeds when seed param is provided', async () => {
      const ctx = createMockCtx();
      const input = createDefaultInput({
        params: {
          prompt: 'test prompt',
          seed: 42,
        },
      });

      const caller = imageRouter.createCaller(ctx);
      await caller.createImage(input);

      expect(mockServerDB.transaction).toHaveBeenCalled();
    });

    it('should use null seeds when seed param is not provided', async () => {
      const ctx = createMockCtx();
      const input = createDefaultInput({
        params: {
          prompt: 'test prompt',
          // No seed param
        },
      });

      const caller = imageRouter.createCaller(ctx);
      await caller.createImage(input);

      expect(mockServerDB.transaction).toHaveBeenCalled();
    });

    it('should pass with valid key-based imageUrls', async () => {
      mockGetKeyFromFullUrl.mockResolvedValue('files/valid-key.jpg');

      const ctx = createMockCtx();
      const input = createDefaultInput({
        params: {
          prompt: 'test prompt',
          imageUrls: ['files/valid-key.jpg'],
        },
      });

      const caller = imageRouter.createCaller(ctx);
      const result = await caller.createImage(input);

      expect(result.success).toBe(true);
    });

    describe('development environment URL conversion', () => {
      beforeEach(() => {
        vi.stubEnv('NODE_ENV', 'development');
      });

      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it('should convert single imageUrl to S3 URL in development mode', async () => {
        mockGetKeyFromFullUrl.mockResolvedValue('files/image-key.jpg');
        mockGetFullFileUrl.mockResolvedValue('https://s3.amazonaws.com/bucket/files/image-key.jpg');

        const ctx = createMockCtx();
        const input = createDefaultInput({
          params: {
            prompt: 'test prompt',
            imageUrl: 'http://localhost:3000/f/file-id',
          },
        });

        const caller = imageRouter.createCaller(ctx);
        const result = await caller.createImage(input);

        expect(result.success).toBe(true);
        expect(mockGetFullFileUrl).toHaveBeenCalledWith('files/image-key.jpg');
      });

      it('should convert multiple imageUrls to S3 URLs in development mode', async () => {
        mockGetKeyFromFullUrl
          .mockResolvedValueOnce('files/image1.jpg')
          .mockResolvedValueOnce('files/image2.jpg');
        mockGetFullFileUrl
          .mockResolvedValueOnce('https://s3.amazonaws.com/bucket/files/image1.jpg')
          .mockResolvedValueOnce('https://s3.amazonaws.com/bucket/files/image2.jpg');

        const ctx = createMockCtx();
        const input = createDefaultInput({
          params: {
            prompt: 'test prompt',
            imageUrls: ['http://localhost:3000/f/id1', 'http://localhost:3000/f/id2'],
          },
        });

        const caller = imageRouter.createCaller(ctx);
        const result = await caller.createImage(input);

        expect(result.success).toBe(true);
        expect(mockGetFullFileUrl).toHaveBeenCalledTimes(2);
        expect(mockGetFullFileUrl).toHaveBeenCalledWith('files/image1.jpg');
        expect(mockGetFullFileUrl).toHaveBeenCalledWith('files/image2.jpg');
      });

      it('should not convert URLs when getFullFileUrl returns null', async () => {
        mockGetKeyFromFullUrl.mockResolvedValue('files/image-key.jpg');
        mockGetFullFileUrl.mockResolvedValue(null);

        const ctx = createMockCtx();
        const input = createDefaultInput({
          params: {
            prompt: 'test prompt',
            imageUrl: 'http://localhost:3000/f/file-id',
          },
        });

        const caller = imageRouter.createCaller(ctx);
        const result = await caller.createImage(input);

        expect(result.success).toBe(true);
        expect(mockGetFullFileUrl).toHaveBeenCalled();
      });
    });
  });
});
