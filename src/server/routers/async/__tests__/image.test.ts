import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockCreateImage,
  mockInitModelRuntimeFromDB,
  mockResolveBusinessModelMapping,
  mockFindDeploymentName,
  mockFindBatchById,
  mockAsyncTaskUpdate,
  mockTransformImageForGeneration,
  mockUploadImageForGeneration,
  mockCreateAssetAndFile,
  mockNotifyImageCompleted,
  mockGetProviderContentPolicyErrorMessage,
} = vi.hoisted(() => ({
  mockCreateImage: vi.fn(),
  mockInitModelRuntimeFromDB: vi.fn(),
  mockResolveBusinessModelMapping: vi.fn(),
  mockFindDeploymentName: vi.fn(),
  mockFindBatchById: vi.fn(),
  mockAsyncTaskUpdate: vi.fn(),
  mockTransformImageForGeneration: vi.fn(),
  mockUploadImageForGeneration: vi.fn(),
  mockCreateAssetAndFile: vi.fn(),
  mockNotifyImageCompleted: vi.fn(),
  mockGetProviderContentPolicyErrorMessage: vi.fn(),
}));

vi.mock('debug', () => ({
  default: () => () => {},
}));

vi.mock('@lobechat/business-config/server', () => ({
  ASYNC_TASK_TIMEOUT: 60_000,
}));

vi.mock('@lobechat/business-const', () => ({
  ENABLE_BUSINESS_FEATURES: false,
}));

vi.mock('@lobechat/business-model-runtime', () => ({
  buildMappedBusinessModelFields: ({
    provider,
    resolvedModelId,
    requestedModelId,
  }: {
    provider: string;
    resolvedModelId: string;
    requestedModelId?: string;
  }) => ({
    modelId: resolvedModelId,
    providerId: provider,
    ...(requestedModelId ? { requestedModelId } : {}),
  }),
  resolveBusinessModelMapping: (...args: [string, string]) =>
    mockResolveBusinessModelMapping(...args),
}));

vi.mock('@lobechat/model-runtime', () => ({
  AgentRuntimeErrorType: {
    ComfyUIServiceUnavailable: 'ComfyUIServiceUnavailable',
    ComfyUIBizError: 'ComfyUIBizError',
    ComfyUIWorkflowError: 'ComfyUIWorkflowError',
    ComfyUIModelError: 'ComfyUIModelError',
    ConnectionCheckFailed: 'ConnectionCheckFailed',
    PermissionDenied: 'PermissionDenied',
    ModelNotFound: 'ModelNotFound',
    ProviderNoImageGenerated: 'ProviderNoImageGenerated',
    InvalidProviderAPIKey: 'InvalidProviderAPIKey',
  },
}));

vi.mock('@lobechat/types', () => {
  class AsyncTaskError extends Error {
    constructor(
      public readonly name: string,
      public readonly body: any,
    ) {
      super(typeof body === 'string' ? body : body?.detail ?? name);
    }
  }

  return {
    AsyncTaskError,
    AsyncTaskErrorType: {
      ServerError: 'ServerError',
      InvalidProviderAPIKey: 'InvalidProviderAPIKey',
      ModelNotFound: 'ModelNotFound',
      ProviderContentModeration: 'ProviderContentModeration',
      Timeout: 'Timeout',
    },
    AsyncTaskStatus: {
      Processing: 'processing',
      Success: 'success',
      Error: 'error',
    },
    RequestTrigger: {
      Image: 'image',
    },
  };
});

vi.mock('@trpc/server', () => ({
  TRPCError: class TRPCError extends Error {
    code: string;
    constructor(init: { code: string; message?: string }) {
      super(init.message);
      this.code = init.code;
    }
  },
}));

vi.mock('@/business/server/getProviderContentPolicyErrorMessage', () => ({
  getProviderContentPolicyErrorMessage: (...args: any[]) =>
    mockGetProviderContentPolicyErrorMessage(...args),
}));

vi.mock('@/business/server/image-generation/chargeAfterGenerate', () => ({
  chargeAfterGenerate: vi.fn(),
}));

vi.mock('@/business/server/image-generation/notifyImageCompleted', () => ({
  notifyImageCompleted: (...args: any[]) => mockNotifyImageCompleted(...args),
}));

vi.mock('@/business/server/trpc-middlewares/async', () => ({
  createImageBusinessMiddleware: ({ next }: { next: (opts?: any) => any }) => next(),
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    update: mockAsyncTaskUpdate,
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({})),
}));

vi.mock('@/database/models/generation', () => ({
  GenerationModel: vi.fn(() => ({
    createAssetAndFile: mockCreateAssetAndFile,
  })),
}));

vi.mock('@/database/models/generationBatch', () => ({
  GenerationBatchModel: vi.fn(() => ({
    findById: mockFindBatchById,
  })),
}));

vi.mock('@/libs/trpc/async', () => {
  // Minimal trpc-like shim that lets us call the mutation resolver directly.
  const chain = {
    use: () => chain,
    input: () => chain,
    mutation: (resolver: any) => resolver,
  };
  return {
    asyncAuthedProcedure: chain,
    asyncRouter: (routes: Record<string, any>) => routes,
  };
});

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: (...args: any[]) => mockInitModelRuntimeFromDB(...args),
  findDeploymentName: (...args: any[]) => mockFindDeploymentName(...args),
}));

vi.mock('@/server/services/generation', () => ({
  GenerationService: vi.fn(() => ({
    transformImageForGeneration: mockTransformImageForGeneration,
    uploadImageForGeneration: mockUploadImageForGeneration,
  })),
}));

vi.mock('@/utils/sanitizeFileName', () => ({
  sanitizeFileName: (name: string) => name,
}));

vi.mock('../contentPolicyError', () => ({
  getContentPolicyErrorMessage: () => undefined,
}));

// Import after mocks are registered.
import { imageRouter } from '../image';

describe('imageRouter.createImage — Azure deployment name resolution (issue #14450)', () => {
  const baseCtx = {
    userId: 'user-1',
    serverDB: {} as any,
    asyncTaskModel: { update: mockAsyncTaskUpdate },
    fileModel: {},
    generationBatchModel: { findById: mockFindBatchById },
    generationModel: { createAssetAndFile: mockCreateAssetAndFile },
    generationService: {
      transformImageForGeneration: mockTransformImageForGeneration,
      uploadImageForGeneration: mockUploadImageForGeneration,
    },
  };

  const baseInput = {
    taskId: 'task-1',
    generationId: 'gen-1',
    generationBatchId: 'batch-1',
    generationTopicId: 'topic-1',
    provider: 'azure',
    model: 'gpt-image-2',
    params: {
      prompt: 'a pixel cat',
      width: 1024,
      height: 1024,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFindBatchById.mockResolvedValue({
      id: 'batch-1',
      createdAt: new Date(Date.now() - 1000),
    });

    mockResolveBusinessModelMapping.mockImplementation(
      async (_provider: string, model: string) => ({ resolvedModelId: model }),
    );

    mockCreateImage.mockResolvedValue({
      imageUrl: 'https://example.com/out.png',
      width: 1024,
      height: 1024,
    });

    mockInitModelRuntimeFromDB.mockResolvedValue({
      createImage: mockCreateImage,
      getAuthHeaders: () => undefined,
    });

    mockTransformImageForGeneration.mockResolvedValue({
      image: { hash: 'h', mime: 'image/png', extension: 'png', size: 1, height: 1024, width: 1024 },
      thumbnailImage: {},
    });

    mockUploadImageForGeneration.mockResolvedValue({
      imageUrl: 'https://s3.example.com/out.png',
      thumbnailImageUrl: 'https://s3.example.com/out-thumb.png',
    });

    mockCreateAssetAndFile.mockResolvedValue(undefined);
    mockAsyncTaskUpdate.mockResolvedValue(undefined);
    mockNotifyImageCompleted.mockResolvedValue(undefined);
    mockGetProviderContentPolicyErrorMessage.mockResolvedValue(undefined);
  });

  it('passes the configured Azure deployment name (not the raw model id) to createImage', async () => {
    mockFindDeploymentName.mockResolvedValueOnce('my-dalle-deployment');

    await imageRouter.createImage({ ctx: baseCtx, input: baseInput });

    // findDeploymentName is called with the business-resolved model id so that
    // any billing-alias resolution still happens first.
    expect(mockFindDeploymentName).toHaveBeenCalledWith(
      baseCtx.serverDB,
      baseCtx.userId,
      'gpt-image-2',
      'azure',
    );

    expect(mockCreateImage).toHaveBeenCalledTimes(1);
    const createImagePayload = mockCreateImage.mock.calls[0][0];
    expect(createImagePayload.model).toBe('my-dalle-deployment');
    // The raw model id must NOT leak through to the provider when a deployment
    // is configured — this is what caused `400 Unknown model: gpt-image-2`.
    expect(createImagePayload.model).not.toBe('gpt-image-2');
  });

  it('falls back to the model id when no deployment name is configured', async () => {
    // Helper contract: returns the model id unchanged when there is no mapping.
    mockFindDeploymentName.mockImplementationOnce(
      async (_db: unknown, _uid: string, model: string) => model,
    );

    await imageRouter.createImage({
      ctx: baseCtx,
      input: { ...baseInput, provider: 'openai', model: 'dall-e-3' },
    });

    expect(mockCreateImage).toHaveBeenCalledTimes(1);
    expect(mockCreateImage.mock.calls[0][0].model).toBe('dall-e-3');
  });

  it('resolves the deployment name after the business model mapping (billing alias)', async () => {
    // Simulate a business alias that remaps the requested model to a canonical
    // billing model id, then a deployment-name lookup on the canonical id.
    mockResolveBusinessModelMapping.mockResolvedValueOnce({
      requestedModelId: 'gpt-image-2-alias',
      resolvedModelId: 'gpt-image-2',
    });
    mockFindDeploymentName.mockResolvedValueOnce('my-dalle-deployment');

    await imageRouter.createImage({
      ctx: baseCtx,
      input: { ...baseInput, model: 'gpt-image-2-alias' },
    });

    expect(mockResolveBusinessModelMapping).toHaveBeenCalledWith('azure', 'gpt-image-2-alias');
    // Deployment lookup happens on the business-resolved id, not the raw input.
    expect(mockFindDeploymentName).toHaveBeenCalledWith(
      baseCtx.serverDB,
      baseCtx.userId,
      'gpt-image-2',
      'azure',
    );
    expect(mockCreateImage.mock.calls[0][0].model).toBe('my-dalle-deployment');
  });
});
