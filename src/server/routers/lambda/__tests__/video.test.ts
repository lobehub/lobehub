import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileService } from '@/server/services/file';
import { AsyncTaskStatus } from '@/types/asyncTask';

// ---- hoisted mocks (available inside vi.mock factories) ----

const {
  mockAfter,
  mockCreateVideo,
  mockProcessBackgroundVideoPolling,
  mockServerDB,
  mockTransaction,
} = vi.hoisted(() => {
  const mockTransaction = vi.fn();
  const mockServerDB = { transaction: mockTransaction };
  const mockCreateVideo = vi.fn();
  const mockAfter = vi.fn((cb: () => void) => cb());
  const mockProcessBackgroundVideoPolling = vi.fn().mockResolvedValue(undefined);
  return {
    mockAfter,
    mockCreateVideo,
    mockProcessBackgroundVideoPolling,
    mockServerDB,
    mockTransaction,
  };
});

// ---- module-level mocks ----

vi.mock('@/database/models/asyncTask');
vi.mock('@/server/services/file');

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue(mockServerDB),
}));
vi.mock('@/database/server', () => ({
  getServerDB: vi.fn().mockResolvedValue(mockServerDB),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn().mockResolvedValue({ createVideo: mockCreateVideo }),
}));
vi.mock('@/business/server/video-generation/chargeBeforeGenerate', () => ({
  chargeBeforeGenerate: vi.fn().mockResolvedValue({ errorBatch: null, prechargeResult: null }),
}));
vi.mock('@/business/server/video-generation/chargeAfterGenerate', () => ({
  chargeAfterGenerate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/business/server/video-generation/getVideoFreeQuota', () => ({
  getVideoFreeQuota: vi.fn().mockResolvedValue({ remaining: 10 }),
}));
vi.mock('next/server', () => ({ after: (cb: () => void) => mockAfter(cb) }));
vi.mock('@/server/services/generation/videoBackgroundPolling', () => ({
  processBackgroundVideoPolling: mockProcessBackgroundVideoPolling,
}));
vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));
vi.mock('debug', () => ({ default: vi.fn(() => vi.fn()) }));

// ---- helpers ----

const defaultInput = {
  generationTopicId: 'topic-1',
  model: 'test-model',
  params: { prompt: 'a cat dancing' },
  provider: 'volcengine',
};

const txResult = {
  asyncTaskCreatedAt: new Date('2026-01-01'),
  asyncTaskId: 'async-1',
  batch: { id: 'batch-1' },
  generation: { id: 'gen-1' },
};

// Minimal drizzle-like chain mocks
function createInsertChain() {
  return vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi
        .fn()
        .mockResolvedValueOnce([txResult.batch])
        .mockResolvedValueOnce([txResult.generation])
        .mockResolvedValueOnce([
          { id: txResult.asyncTaskId, createdAt: txResult.asyncTaskCreatedAt },
        ]),
    }),
  });
}

const mockDbUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
});

function setupMocks() {
  const mockUpdate = vi.fn().mockResolvedValue(undefined);

  vi.mocked(AsyncTaskModel).mockImplementation(() => ({ update: mockUpdate }) as any);
  vi.mocked(FileService).mockImplementation(
    () =>
      ({
        getFullFileUrl: vi.fn().mockResolvedValue(null),
        getKeyFromFullUrl: vi.fn().mockResolvedValue(null),
      }) as any,
  );

  const mockInsert = createInsertChain();
  mockTransaction.mockImplementation(async (cb: any) =>
    cb({ insert: mockInsert, update: mockDbUpdate }),
  );

  return { mockUpdate };
}

// ---- import router AFTER mocks are set up ----

const { videoRouter } = await import('../video');

// ---- tests ----

describe('videoRouter', () => {
  const mockCtx = { userId: 'test-user' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createVideo - async strategy routing', () => {
    it('should use webhook path when response contains useWebhook: true', async () => {
      const { mockUpdate } = setupMocks();
      mockCreateVideo.mockResolvedValue({ inferenceId: 'inf-1', useWebhook: true });

      const caller = videoRouter.createCaller(mockCtx);
      const result = await caller.createVideo(defaultInput);

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith('async-1', {
        inferenceId: 'inf-1',
        status: AsyncTaskStatus.Processing,
      });
      // Webhook: should NOT trigger background polling
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it('should use polling path when response contains only inferenceId', async () => {
      const { mockUpdate } = setupMocks();
      mockCreateVideo.mockResolvedValue({ inferenceId: 'inf-2' });

      const caller = videoRouter.createCaller(mockCtx);
      const result = await caller.createVideo(defaultInput);

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith('async-1', {
        inferenceId: 'inf-2',
        status: AsyncTaskStatus.Processing,
      });
      // Polling: should trigger background polling via after()
      expect(mockAfter).toHaveBeenCalled();
      expect(mockProcessBackgroundVideoPolling).toHaveBeenCalled();
    });

    it('should use polling path when response contains videoUrl (no special handling)', async () => {
      const { mockUpdate } = setupMocks();
      mockCreateVideo.mockResolvedValue({
        inferenceId: 'inf-3',
        videoUrl: 'https://cdn.example.com/video.mp4',
      });

      const caller = videoRouter.createCaller(mockCtx);
      const result = await caller.createVideo(defaultInput);

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith('async-1', {
        inferenceId: 'inf-3',
        status: AsyncTaskStatus.Processing,
      });
      // No special videoUrl branch — falls through to polling
      expect(mockAfter).toHaveBeenCalled();
      expect(mockProcessBackgroundVideoPolling).toHaveBeenCalled();
    });

    it('should fall through to polling when useWebhook is false', async () => {
      setupMocks();
      mockCreateVideo.mockResolvedValue({ inferenceId: 'inf-4', useWebhook: false });

      const caller = videoRouter.createCaller(mockCtx);
      await caller.createVideo(defaultInput);

      // useWebhook=false means not webhook, should fall to polling
      expect(mockAfter).toHaveBeenCalled();
      expect(mockProcessBackgroundVideoPolling).toHaveBeenCalled();
    });
  });

  describe('createVideo - error handling', () => {
    it('should set error status when createVideo throws', async () => {
      const { mockUpdate } = setupMocks();
      mockCreateVideo.mockRejectedValue(new Error('API timeout'));

      const caller = videoRouter.createCaller(mockCtx);
      const result = await caller.createVideo(defaultInput);

      // Batch was already created, so still returns success structure
      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        'async-1',
        expect.objectContaining({ status: AsyncTaskStatus.Error }),
      );
    });
  });

  describe('createVideo - pre-charge', () => {
    it('should return error batch when pre-charge fails', async () => {
      setupMocks();
      const { chargeBeforeGenerate } =
        await import('@/business/server/video-generation/chargeBeforeGenerate');
      vi.mocked(chargeBeforeGenerate).mockResolvedValueOnce({
        errorBatch: { error: 'insufficient_balance' } as any,
        prechargeResult: undefined,
      });

      const caller = videoRouter.createCaller(mockCtx);
      const result = await caller.createVideo(defaultInput);

      expect(result).toEqual({ error: 'insufficient_balance' });
      // Should not proceed to createVideo
      expect(mockCreateVideo).not.toHaveBeenCalled();
    });
  });

  describe('createVideo - return value', () => {
    it('should return batch and generation data', async () => {
      setupMocks();
      mockCreateVideo.mockResolvedValue({ inferenceId: 'inf-5', useWebhook: true });

      const caller = videoRouter.createCaller(mockCtx);
      const result = await caller.createVideo(defaultInput);

      expect(result).toEqual({
        data: {
          batch: txResult.batch,
          generations: [{ ...txResult.generation, asyncTaskId: 'async-1' }],
        },
        success: true,
      });
    });
  });
});
