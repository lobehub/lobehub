import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileService } from '@/server/services/file';
import { AsyncTaskStatus } from '@/types/asyncTask';

// ---- hoisted mocks (available inside vi.mock factories) ----

const {
  mockCreateVideo,
  mockFindPreviousGeneration,
  mockFindUserById,
  mockGenerationTopicFindById,
  mockIsLobeHubModelAvailable,
  mockProcessBackgroundVideoPolling,
  mockResolveBusinessModelMapping,
  mockAfter,
  mockAppEnv,
  mockServerDB,
  mockTransaction,
} = vi.hoisted(() => {
  const mockTransaction = vi.fn();
  const mockServerDB = {
    query: {
      generationBatches: {
        findFirst: vi.fn(),
      },
    },
    transaction: mockTransaction,
  };
  const mockCreateVideo = vi.fn();
  const mockAfter = vi.fn((cb: () => void) => cb());
  const mockAppEnv = {
    APP_URL: 'https://app.example.com',
    VIDEO_GENERATION_PREFER_WEBHOOK: false,
    WEBHOOK_PROXY_URL: undefined as string | undefined,
  };
  const mockFindPreviousGeneration = vi.fn();
  const mockFindUserById = vi.fn();
  const mockGenerationTopicFindById = vi.fn();
  const mockIsLobeHubModelAvailable = vi.fn();
  const mockProcessBackgroundVideoPolling = vi.fn().mockResolvedValue(undefined);
  const mockResolveBusinessModelMapping = vi.fn();
  return {
    mockCreateVideo,
    mockFindPreviousGeneration,
    mockFindUserById,
    mockGenerationTopicFindById,
    mockIsLobeHubModelAvailable,
    mockProcessBackgroundVideoPolling,
    mockResolveBusinessModelMapping,
    mockAfter,
    mockAppEnv,
    mockServerDB,
    mockTransaction,
  };
});

// ---- module-level mocks ----

vi.mock('@/database/models/asyncTask');
vi.mock('@/database/models/generation', () => ({
  GenerationModel: vi.fn(() => ({
    findById: mockFindPreviousGeneration,
  })),
}));
vi.mock('@/database/models/generationTopic', () => ({
  GenerationTopicModel: vi.fn(() => ({
    findById: mockGenerationTopicFindById,
  })),
}));
vi.mock('@/server/services/file');
vi.mock('@/database/models/user', () => ({
  UserModel: {
    findById: mockFindUserById,
  },
}));

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
vi.mock('@lobechat/business-model-runtime', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  resolveBusinessModelMapping: (...args: [string, string]) =>
    mockResolveBusinessModelMapping(...args),
}));
vi.mock('@lobechat/business-model-bank/model-config', () => ({
  isLobeHubModelAvailable: (
    ...args: [
      string,
      string,
      { getUserEmail?: () => Promise<string | null | undefined>; userEmail?: string | null }?,
    ]
  ) => mockIsLobeHubModelAvailable(...args),
}));
vi.mock('@/business/server/video-generation/getVideoFreeQuota', () => ({
  getVideoFreeQuota: vi.fn().mockResolvedValue({ remaining: 10 }),
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (cb: () => void) => mockAfter(cb),
}));
vi.mock('@/server/services/generation/videoBackgroundPolling', () => ({
  processBackgroundVideoPolling: mockProcessBackgroundVideoPolling,
}));
vi.mock('@/envs/app', () => ({
  appEnv: mockAppEnv,
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
  const mockGetFullFileUrl = vi.fn().mockResolvedValue(null);
  const mockGetKeyFromFullUrl = vi.fn().mockResolvedValue(null);

  vi.mocked(AsyncTaskModel).mockImplementation(() => ({ update: mockUpdate }) as any);
  vi.mocked(FileService).mockImplementation(
    () =>
      ({
        getFullFileUrl: mockGetFullFileUrl,
        getKeyFromFullUrl: mockGetKeyFromFullUrl,
      }) as any,
  );

  const mockInsert = createInsertChain();
  mockTransaction.mockImplementation(async (cb: any) =>
    cb({ insert: mockInsert, update: mockDbUpdate }),
  );

  return { mockGetFullFileUrl, mockGetKeyFromFullUrl, mockInsert, mockUpdate };
}

// ---- import router AFTER mocks are set up ----

const { videoRouter } = await import('../video');

// ---- tests ----

describe('videoRouter', () => {
  const mockCtx = { userId: 'test-user' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveBusinessModelMapping.mockImplementation(
      async (_provider: string, model: string) => ({
        resolvedModelId: model,
      }),
    );
    mockFindUserById.mockResolvedValue({ email: 'user@example.com' });
    mockFindPreviousGeneration.mockResolvedValue(undefined);
    mockGenerationTopicFindById.mockResolvedValue({ id: 'topic-1' });
    mockIsLobeHubModelAvailable.mockResolvedValue(true);
    mockServerDB.query.generationBatches.findFirst.mockResolvedValue(undefined);
    mockAppEnv.VIDEO_GENERATION_PREFER_WEBHOOK = false;
    mockAppEnv.WEBHOOK_PROXY_URL = undefined;
  });

  describe('createVideo - async strategy routing', () => {
    it('should use the webhook path when selected by the runtime', async () => {
      const { mockUpdate } = setupMocks();
      mockCreateVideo.mockResolvedValue({
        completionMode: 'webhook',
        inferenceId: 'inf-1',
      });

      const caller = videoRouter.createCaller(mockCtx);
      const result = await caller.createVideo(defaultInput);

      expect(result.success).toBe(true);
      expect(mockCreateVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackUrl: expect.stringMatching(/^https:\/\/app\.example\.com\/api\/webhooks\/video/),
        }),
        expect.objectContaining({ preferredCompletionMode: 'polling' }),
      );
      expect(mockUpdate).toHaveBeenCalledWith('async-1', {
        inferenceId: 'inf-1',
        metadata: {
          completionMode: 'webhook',
          webhookToken: expect.any(String),
        },
        status: AsyncTaskStatus.Processing,
      });
      // Webhook: should NOT trigger background polling
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it('should pass the webhook preference and typed proxy callback URL to the runtime', async () => {
      setupMocks();
      mockAppEnv.VIDEO_GENERATION_PREFER_WEBHOOK = true;
      mockAppEnv.WEBHOOK_PROXY_URL = 'https://local-tunnel.example.com';
      mockCreateVideo.mockResolvedValue({
        completionMode: 'webhook',
        inferenceId: 'inf-proxy',
      });

      const caller = videoRouter.createCaller(mockCtx);
      await caller.createVideo(defaultInput);

      expect(mockCreateVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackUrl: expect.stringMatching(
            /^https:\/\/local-tunnel\.example\.com\/api\/webhooks\/video/,
          ),
        }),
        expect.objectContaining({ preferredCompletionMode: 'webhook' }),
      );
    });

    it('should preserve route metadata without polling for a webhook-based interaction', async () => {
      const { mockUpdate } = setupMocks();
      mockCreateVideo.mockImplementation(async (_payload, options) => {
        options.metadata.routeAttempt = {
          apiType: 'google',
          channelId: 'google-channel-2',
          routerId: 'google-router',
        };

        return {
          completionMode: 'webhook',
          inferenceId: 'interactions/omni-1',
        };
      });

      const caller = videoRouter.createCaller(mockCtx);
      await caller.createVideo(defaultInput);

      expect(mockAfter).not.toHaveBeenCalled();
      expect(mockProcessBackgroundVideoPolling).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith(
        'async-1',
        expect.objectContaining({
          metadata: expect.objectContaining({
            route: {
              apiType: 'google',
              channelId: 'google-channel-2',
              routerId: 'google-router',
            },
          }),
        }),
      );
    });

    it('should preserve reference image URLs that are not storage files', async () => {
      const { mockGetKeyFromFullUrl, mockInsert } = setupMocks();
      const imageUrls = [
        'https://images.example.com/reference.png',
        'data:image/png;base64,reference',
      ];
      mockGetKeyFromFullUrl.mockResolvedValue(null);
      mockCreateVideo.mockResolvedValue({
        completionMode: 'webhook',
        inferenceId: 'inf-reference',
      });

      const caller = videoRouter.createCaller(mockCtx);
      await caller.createVideo({
        ...defaultInput,
        params: { ...defaultInput.params, imageUrls },
      });

      const values = mockInsert.mock.results[0].value.values;
      expect(values).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          config: expect.objectContaining({ imageUrls }),
        }),
      );
    });

    it('should pass the previous interaction when editing a compatible video', async () => {
      const { mockInsert } = setupMocks();
      mockFindPreviousGeneration.mockResolvedValue({
        asset: { interactionId: 'interactions/source-1', type: 'video' },
        generationBatchId: 'source-batch',
        id: 'source-generation',
      });
      mockServerDB.query.generationBatches.findFirst.mockResolvedValue({
        generationTopicId: 'topic-1',
        id: 'source-batch',
        model: 'gemini-omni-flash-preview',
        provider: 'google',
      });
      mockCreateVideo.mockResolvedValue({
        completionMode: 'webhook',
        inferenceId: 'interactions/edit-1',
      });

      const caller = videoRouter.createCaller(mockCtx);
      await caller.createVideo({
        ...defaultInput,
        model: 'gemini-omni-flash-preview',
        previousGenerationId: 'source-generation',
        provider: 'google',
      });

      expect(mockCreateVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ task: 'edit' }),
          previousInteractionId: 'interactions/source-1',
        }),
        expect.any(Object),
      );

      const values = mockInsert.mock.results[0].value.values;
      expect(values.mock.calls[0][0].config).not.toHaveProperty('previousGenerationId');
      expect(values).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          metadata: expect.objectContaining({ previousGenerationId: 'source-generation' }),
        }),
      );
    });

    it('should reject editing with a model that has no conversational video support', async () => {
      setupMocks();

      const caller = videoRouter.createCaller(mockCtx);

      await expect(
        caller.createVideo({
          ...defaultInput,
          previousGenerationId: 'source-generation',
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'The selected model does not support conversational video editing',
      });
      expect(mockFindPreviousGeneration).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should reject editing across models', async () => {
      setupMocks();
      mockFindPreviousGeneration.mockResolvedValue({
        asset: { interactionId: 'interactions/source-1', type: 'video' },
        generationBatchId: 'source-batch',
        id: 'source-generation',
      });
      mockServerDB.query.generationBatches.findFirst.mockResolvedValue({
        generationTopicId: 'topic-1',
        id: 'source-batch',
        model: 'different-model',
        provider: 'volcengine',
      });

      const caller = videoRouter.createCaller(mockCtx);

      await expect(
        caller.createVideo({
          ...defaultInput,
          model: 'gemini-omni-flash-preview',
          previousGenerationId: 'source-generation',
          provider: 'google',
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Previous video generation cannot be edited with the selected model',
      });
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockCreateVideo).not.toHaveBeenCalled();
    });

    it('should validate mapped model id before rejecting deprecated lobehub video models', async () => {
      setupMocks();
      mockResolveBusinessModelMapping.mockResolvedValue({
        requestedModelId: 'onboarding-video',
        resolvedModelId: 'dreamina-seedance-2-0-260128',
      });
      mockCreateVideo.mockResolvedValue({
        completionMode: 'webhook',
        inferenceId: 'inf-mapped',
      });

      const caller = videoRouter.createCaller(mockCtx);
      const result = await caller.createVideo({
        ...defaultInput,
        model: 'onboarding-video',
        provider: 'lobehub',
      });

      expect(result.success).toBe(true);
      expect(mockResolveBusinessModelMapping).toHaveBeenCalledWith('lobehub', 'onboarding-video');
      expect(mockIsLobeHubModelAvailable).toHaveBeenCalledWith(
        'dreamina-seedance-2-0-260128',
        'video',
        { getUserEmail: expect.any(Function) },
      );
      const availabilityOptions = mockIsLobeHubModelAvailable.mock.calls.at(-1)?.[2];
      expect(mockFindUserById).not.toHaveBeenCalled();
      await expect(availabilityOptions!.getUserEmail!()).resolves.toBe('user@example.com');
      expect(mockFindUserById).toHaveBeenCalledWith(mockServerDB, mockCtx.userId);
      expect(mockCreateVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackUrl: expect.stringContaining('model=dreamina-seedance-2-0-260128'),
          model: 'dreamina-seedance-2-0-260128',
        }),
        expect.any(Object),
      );
    });

    it('should reject unavailable lobehub video models before creating async tasks', async () => {
      setupMocks();
      mockIsLobeHubModelAvailable.mockResolvedValue(false);

      const caller = videoRouter.createCaller(mockCtx);

      await expect(
        caller.createVideo({
          ...defaultInput,
          model: 'restricted-video-model',
          provider: 'lobehub',
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'LobeHubModelDeprecated',
      });

      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockCreateVideo).not.toHaveBeenCalled();
    });

    it('should reject inaccessible generation topic before charging or creating records', async () => {
      setupMocks();
      mockGenerationTopicFindById.mockResolvedValue(undefined);

      const caller = videoRouter.createCaller({ userId: 'test-user', workspaceId: 'workspace-1' });

      await expect(caller.createVideo(defaultInput)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Invalid generation topic',
      });

      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockCreateVideo).not.toHaveBeenCalled();
    });

    it('should use the polling path when selected by the runtime', async () => {
      const { mockUpdate } = setupMocks();
      mockCreateVideo.mockResolvedValue({
        completionMode: 'polling',
        inferenceId: 'inf-2',
      });

      const caller = videoRouter.createCaller(mockCtx);
      const result = await caller.createVideo(defaultInput);

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith('async-1', {
        inferenceId: 'inf-2',
        metadata: {
          completionMode: 'polling',
          webhookToken: expect.any(String),
        },
        status: AsyncTaskStatus.Processing,
      });
      // Polling: should trigger background polling after the response.
      expect(mockAfter).toHaveBeenCalled();
      expect(mockProcessBackgroundVideoPolling).toHaveBeenCalled();
    });

    it('should use polling path when response contains videoUrl (no special handling)', async () => {
      const { mockUpdate } = setupMocks();
      mockCreateVideo.mockResolvedValue({
        completionMode: 'polling',
        inferenceId: 'inf-3',
        videoUrl: 'https://cdn.example.com/video.mp4',
      });

      const caller = videoRouter.createCaller(mockCtx);
      const result = await caller.createVideo(defaultInput);

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith('async-1', {
        inferenceId: 'inf-3',
        metadata: {
          completionMode: 'polling',
          webhookToken: expect.any(String),
        },
        status: AsyncTaskStatus.Processing,
      });
      // No special videoUrl branch — falls through to polling
      expect(mockAfter).toHaveBeenCalled();
      expect(mockProcessBackgroundVideoPolling).toHaveBeenCalled();
    });

    it('should not start polling for a webhook task', async () => {
      setupMocks();
      mockCreateVideo.mockResolvedValue({
        completionMode: 'webhook',
        inferenceId: 'inf-4',
      });

      const caller = videoRouter.createCaller(mockCtx);
      await caller.createVideo(defaultInput);

      expect(mockAfter).not.toHaveBeenCalled();
      expect(mockProcessBackgroundVideoPolling).not.toHaveBeenCalled();
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
      mockCreateVideo.mockResolvedValue({
        completionMode: 'webhook',
        inferenceId: 'inf-5',
      });

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
