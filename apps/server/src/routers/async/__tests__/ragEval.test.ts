// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EvalDatasetRecordModel,
  EvalEvaluationModel,
  EvaluationRecordModel,
} from '@/database/models/ragEval';

import { ragEvalRouter } from '../ragEval';

vi.mock('@/database/models/chunk', () => ({
  ChunkModel: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/database/models/embedding', () => ({
  EmbeddingModel: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/database/models/ragEval', () => ({
  EvalDatasetRecordModel: vi.fn(function () {
    return { findById: vi.fn() };
  }),
  EvalEvaluationModel: vi.fn(function () {
    return { update: vi.fn() };
  }),
  EvaluationRecordModel: vi.fn(function () {
    return { findById: vi.fn().mockResolvedValue(null) };
  }),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));
vi.mock('@/server/services/chunk', () => ({
  ChunkService: vi.fn(function () {
    return {};
  }),
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

describe('ragEvalRouter.runRecordEvaluation', () => {
  const userId = 'user_test';
  const serverDB = {
    select: vi.fn(function () {
      return {
        from: vi.fn(function () {
          return {
            where: vi.fn(function () {
              return {
                limit: vi.fn().mockResolvedValue([{ workspaceId: 'workspace-1' }]),
              };
            }),
          };
        }),
      };
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves workspaceId from the evaluation record before reading scoped models', async () => {
    const caller = ragEvalRouter.createCaller({ serverDB, userId } as any);

    await expect(caller.runRecordEvaluation({ evalRecordId: 'eval-record-1' })).rejects.toThrow(
      TRPCError,
    );

    expect(EvaluationRecordModel).toHaveBeenCalledWith(serverDB, userId, 'workspace-1');
    expect(EvalEvaluationModel).toHaveBeenCalledWith(serverDB, userId, 'workspace-1');
    expect(EvalDatasetRecordModel).toHaveBeenCalledWith(serverDB, userId, 'workspace-1');
  });
});
