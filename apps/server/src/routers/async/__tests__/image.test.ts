// @vitest-environment node
import { resolveBusinessModelMapping } from '@lobechat/business-model-runtime';
import { AsyncTaskStatus } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chargeAfterGenerate } from '@/business/server/image-generation/chargeAfterGenerate';
import { notifyImageCompleted } from '@/business/server/image-generation/notifyImageCompleted';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { GenerationModel } from '@/database/models/generation';
import { GenerationBatchModel } from '@/database/models/generationBatch';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { GenerationService } from '@/server/services/generation';

import { imageRouter } from '../image';

// Constructor-based deps the route instantiates directly.
vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/generation', () => ({ GenerationModel: vi.fn() }));
vi.mock('@/database/models/generationBatch', () => ({ GenerationBatchModel: vi.fn() }));
vi.mock('@/server/services/generation', () => ({ GenerationService: vi.fn() }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));

// Business slots.
vi.mock('@/business/server/getProviderContentPolicyErrorMessage', () => ({
  getProviderContentPolicyErrorMessage: vi.fn(async () => undefined),
}));
vi.mock('@/business/server/image-generation/chargeAfterGenerate', () => ({
  chargeAfterGenerate: vi.fn(),
}));
vi.mock('@/business/server/image-generation/notifyImageCompleted', () => ({
  notifyImageCompleted: vi.fn(),
}));
vi.mock('@/business/server/trpc-middlewares/async', () => ({
  createImageBusinessMiddleware: async (opts: any) => opts.next({ ctx: opts.ctx }),
}));

// The failure-reconciliation path is gated on ENABLE_BUSINESS_FEATURES, which is
// false in the OSS default const package.
vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  ENABLE_BUSINESS_FEATURES: true,
}));

vi.mock('@lobechat/business-model-runtime', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  buildMappedBusinessModelFields: vi.fn(() => ({})),
  resolveBusinessModelMapping: vi.fn(),
}));

vi.mock('@/libs/trpc/async', async () => {
  const init = await vi.importActual<{ asyncTrpc: any }>('@/libs/trpc/async/init');
  const { asyncTrpc } = init;
  return {
    asyncAuthedProcedure: asyncTrpc.procedure,
    asyncRouter: asyncTrpc.router,
    createAsyncCallerFactory: asyncTrpc.createCallerFactory,
    publicProcedure: asyncTrpc.procedure,
  };
});

describe('imageRouter.createImage — model mapping failure reconciles billing', () => {
  const userId = 'user_test';
  let mockCtx: any;
  let asyncTaskModelMock: any;
  let generationBatchModelMock: any;
  let generationModelMock: any;
  let generationServiceMock: any;

  const createInput = (overrides = {}) => ({
    generationBatchId: 'batch-1',
    generationId: 'gen-1',
    generationTopicId: 'topic-1',
    model: 'some-model',
    params: { prompt: 'a beautiful sunset' },
    provider: 'test-provider',
    taskId: 'task-1',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    asyncTaskModelMock = { findById: vi.fn(), update: vi.fn() };
    generationBatchModelMock = { findById: vi.fn() };
    generationModelMock = { createAssetAndFile: vi.fn() };
    generationServiceMock = {
      transformImageForGeneration: vi.fn(),
      uploadImageForGeneration: vi.fn(),
    };

    vi.mocked(AsyncTaskModel).mockImplementation(() => asyncTaskModelMock);
    vi.mocked(GenerationBatchModel).mockImplementation(() => generationBatchModelMock);
    vi.mocked(GenerationModel).mockImplementation(() => generationModelMock);
    vi.mocked(GenerationService).mockImplementation(() => generationServiceMock);
    vi.mocked(FileModel).mockImplementation(() => ({}) as any);
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({} as any);

    // The batch must exist so the route proceeds into the guarded section.
    generationBatchModelMock.findById.mockResolvedValue({ id: 'batch-1', createdAt: new Date() });

    mockCtx = { serverDB: {}, userId };
  });

  it('marks the task Error and reconciles the precharge handle when model mapping throws', async () => {
    asyncTaskModelMock.findById.mockResolvedValue({
      metadata: { precharge: { reservationKey: 'brk-1' } },
    });
    // Regression: this rejection previously happened before the outer try, so the
    // mutation threw without marking the task Error or reconciling billing.
    vi.mocked(resolveBusinessModelMapping).mockRejectedValue(new Error('mapping failed'));

    const caller = imageRouter.createCaller(mockCtx);
    const result = await caller.createImage(createInput());

    // (c) resolves rather than throwing
    expect(result).toMatchObject({ success: false });

    // (a) task marked Error
    expect(asyncTaskModelMock.update).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );

    // (b) billing reconciled once with the loaded precharge handle
    expect(chargeAfterGenerate).toHaveBeenCalledTimes(1);
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        isError: true,
        prechargeResult: { reservationKey: 'brk-1' },
      }),
    );
  });

  it('threads undefined prechargeResult when the task has no precharge handle', async () => {
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: undefined });
    vi.mocked(resolveBusinessModelMapping).mockRejectedValue(new Error('mapping failed'));

    const caller = imageRouter.createCaller(mockCtx);
    const result = await caller.createImage(createInput());

    expect(result).toMatchObject({ success: false });
    expect(chargeAfterGenerate).toHaveBeenCalledTimes(1);
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentShare: undefined,
        isError: true,
        prechargeResult: undefined,
      }),
    );
  });

  // Regression: the async settle hop reads `asyncTask.metadata.agentShare`
  // back off the task row (stamped at submission time by
  // `routers/lambda/image/index.ts`) rather than assuming it absent — this
  // worker runs long after the originating request context is gone, so
  // skipping this read would silently fall back to charging `userId`'s
  // ordinary balance for a share visitor's generation.
  it('reads the agentShare marker off the task metadata and forwards it to chargeAfterGenerate', async () => {
    const agentShare = { agentId: 'agent-1', visitorUserId: 'visitor-1' };
    asyncTaskModelMock.findById.mockResolvedValue({
      metadata: { agentShare, precharge: { reservationKey: 'brk-1' } },
    });
    vi.mocked(resolveBusinessModelMapping).mockRejectedValue(new Error('mapping failed'));

    const caller = imageRouter.createCaller(mockCtx);
    await caller.createImage(createInput());

    expect(chargeAfterGenerate).toHaveBeenCalledTimes(1);
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentShare,
        isError: true,
        prechargeResult: { reservationKey: 'brk-1' },
      }),
    );
  });
});

describe('imageRouter.createImage — creator notification on successful generation', () => {
  const userId = 'user_test';
  let mockCtx: any;
  let asyncTaskModelMock: any;
  let generationBatchModelMock: any;
  let generationModelMock: any;
  let generationServiceMock: any;
  let modelRuntimeMock: any;

  const createInput = (overrides = {}) => ({
    generationBatchId: 'batch-1',
    generationId: 'gen-1',
    generationTopicId: 'topic-1',
    model: 'some-model',
    params: { prompt: 'a beautiful sunset' },
    provider: 'test-provider',
    taskId: 'task-1',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    asyncTaskModelMock = { findById: vi.fn(), update: vi.fn() };
    generationBatchModelMock = { findById: vi.fn() };
    generationModelMock = { createAssetAndFile: vi.fn() };
    generationServiceMock = {
      transformImageForGeneration: vi.fn().mockResolvedValue({
        image: { extension: 'png', hash: 'hash-1', height: 512, mime: 'image/png', size: 1 },
        thumbnailImage: {},
      }),
      uploadImageForGeneration: vi
        .fn()
        .mockResolvedValue({ imageUrl: 'https://cdn.test/image.png', thumbnailImageUrl: '' }),
    };
    modelRuntimeMock = {
      createImage: vi.fn().mockResolvedValue({
        height: 512,
        imageUrl: 'https://upstream.test/image.png',
        modelUsage: {},
        width: 512,
      }),
      getAuthHeaders: vi.fn(),
    };

    vi.mocked(AsyncTaskModel).mockImplementation(() => asyncTaskModelMock);
    vi.mocked(GenerationBatchModel).mockImplementation(() => generationBatchModelMock);
    vi.mocked(GenerationModel).mockImplementation(() => generationModelMock);
    vi.mocked(GenerationService).mockImplementation(() => generationServiceMock);
    vi.mocked(FileModel).mockImplementation(() => ({}) as any);
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue(modelRuntimeMock as any);
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'some-model',
    } as any);

    generationBatchModelMock.findById.mockResolvedValue({ id: 'batch-1', createdAt: new Date() });

    mockCtx = { serverDB: {}, userId };
  });

  it('notifies the creator for an ordinary (non-share) generation', async () => {
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: {} });

    const caller = imageRouter.createCaller(mockCtx);
    const result = await caller.createImage(createInput());

    expect(result).toMatchObject({ success: true });
    expect(notifyImageCompleted).toHaveBeenCalledTimes(1);
    expect(notifyImageCompleted).toHaveBeenCalledWith(expect.objectContaining({ userId }));
  });

  // Regression: a share visitor's generation runs this worker under the
  // creator's own `ctx.userId` (see `agentShare`'s JSDoc in `../image.ts`), so
  // notifying unconditionally would recall the creator's push/inbox for an
  // image an arbitrary link visitor generated.
  it('does not notify the creator for an Agent Share visitor generation', async () => {
    const agentShare = { agentId: 'agent-1', visitorUserId: 'visitor-1' };
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: { agentShare } });

    const caller = imageRouter.createCaller(mockCtx);
    const result = await caller.createImage(createInput());

    expect(result).toMatchObject({ success: true });
    expect(notifyImageCompleted).not.toHaveBeenCalled();
    expect(chargeAfterGenerate).toHaveBeenCalledWith(expect.objectContaining({ agentShare }));
  });
});
