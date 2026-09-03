// @vitest-environment node
import type { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { type AuthContext, createContextInner } from '@/libs/trpc/lambda/context';

import { agentTraceRouter } from './agentTrace';

const mockServerDB = vi.hoisted(() => ({}));
const mocks = vi.hoisted(() => ({
  createPreSignedUrlForPreview: vi.fn(),
  findOwnOperationById: vi.fn(),
  listByTopic: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue(mockServerDB),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(() => ({
    findOwnOperationById: mocks.findOwnOperationById,
    listByTopic: mocks.listByTopic,
  })),
}));

vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn().mockImplementation(() => ({
    createPreSignedUrlForPreview: mocks.createPreSignedUrlForPreview,
  })),
}));

const createCaller = createCallerFactory(agentTraceRouter);

const TRACE_KEY = 'agent-traces/agt_a/tpc_b/op_1_agt_a_tpc_b_c.json.zst';

describe('agentTraceRouter', () => {
  let ctx: AuthContext;
  let router: ReturnType<typeof createCaller>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createContextInner({ userId: 'user-1', workspaceId: 'workspace-1' });
    router = createCaller(ctx);
  });

  describe('getSnapshotUrl', () => {
    it('signs the key recorded on the operation', async () => {
      mocks.findOwnOperationById.mockResolvedValue({ id: 'op-1', traceS3Key: TRACE_KEY });
      mocks.createPreSignedUrlForPreview.mockResolvedValue('https://s3.example.com/obj?sig=abc');

      await expect(router.getSnapshotUrl({ operationId: 'op-1' })).resolves.toEqual({
        data: {
          key: TRACE_KEY,
          operationId: 'op-1',
          url: 'https://s3.example.com/obj?sig=abc',
        },
        success: true,
      });
      expect(mocks.createPreSignedUrlForPreview).toHaveBeenCalledWith(TRACE_KEY);
    });

    it('refuses an operation the caller cannot see, without reaching storage', async () => {
      // findOwnOperationById is ownership-scoped AND excludes agent-share
      // visitor operations, so somebody else's operation — or a visitor
      // conversation's — reads as absent: a leaked operation id must not
      // become a readable trace.
      mocks.findOwnOperationById.mockResolvedValue(null);

      await expect(router.getSnapshotUrl({ operationId: 'op-foreign' })).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' }) as TRPCError,
      );
      expect(mocks.createPreSignedUrlForPreview).not.toHaveBeenCalled();
    });

    it('says the run recorded no trace instead of signing an empty key', async () => {
      mocks.findOwnOperationById.mockResolvedValue({ id: 'op-1', traceS3Key: null });

      await expect(router.getSnapshotUrl({ operationId: 'op-1' })).rejects.toThrow(
        /No trace was recorded/,
      );
      expect(mocks.createPreSignedUrlForPreview).not.toHaveBeenCalled();
    });
  });

  describe('listOperations', () => {
    it('reports trace availability without exposing the storage key', async () => {
      mocks.listByTopic.mockResolvedValue([
        { id: 'op-1', status: 'done', traceS3Key: TRACE_KEY },
        { id: 'op-2', status: 'error', traceS3Key: null },
      ]);

      const result = await router.listOperations({ topicId: 'tpc_b' });

      expect(result.data).toEqual([
        { hasTrace: true, id: 'op-1', status: 'done' },
        { hasTrace: false, id: 'op-2', status: 'error' },
      ]);
      expect(mocks.listByTopic).toHaveBeenCalledWith('tpc_b', 20);
    });
  });
});
