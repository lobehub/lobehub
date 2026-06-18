import { beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeBaseRouter } from '@/server/routers/lambda/knowledgeBase';
import { TransferErrorCode } from '@/types/transferError';

const routerMocks = vi.hoisted(() => ({
  businessFileTransferStorageCheck: vi.fn(),
}));

const mockKnowledgeBaseModelCountFileUsage = vi.fn();
const mockKnowledgeBaseModelCopyToWorkspace = vi.fn();
const mockKnowledgeBaseModelFindById = vi.fn();
const mockKnowledgeBaseModelTransferTo = vi.fn();

vi.mock('@/business/server/lambda-routers/file', () => ({
  businessFileTransferStorageCheck: routerMocks.businessFileTransferStorageCheck,
}));

vi.mock('@/database/models/knowledgeBase', () => ({
  KnowledgeBaseModel: vi.fn(() => ({
    copyToWorkspace: mockKnowledgeBaseModelCopyToWorkspace,
    countFileUsage: mockKnowledgeBaseModelCountFileUsage,
    findById: mockKnowledgeBaseModelFindById,
    transferTo: mockKnowledgeBaseModelTransferTo,
  })),
}));

describe('knowledgeBaseRouter', () => {
  const ctx = {
    serverDB: {},
    userId: 'test-user',
    workspaceId: 'workspace-active',
  };

  const caller = knowledgeBaseRouter.createCaller(ctx as any);

  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.businessFileTransferStorageCheck.mockResolvedValue(undefined);
    mockKnowledgeBaseModelCopyToWorkspace.mockResolvedValue({ id: 'kb-copy' });
    mockKnowledgeBaseModelCountFileUsage.mockResolvedValue(4096);
    mockKnowledgeBaseModelFindById.mockResolvedValue({ id: 'kb-1' });
    mockKnowledgeBaseModelTransferTo.mockResolvedValue({ id: 'kb-1' });
  });

  describe('transferKnowledgeBase', () => {
    it('checks target storage before transferring a library', async () => {
      await caller.transferKnowledgeBase({
        id: 'kb-1',
        targetWorkspaceId: null,
      });

      expect(mockKnowledgeBaseModelCountFileUsage).toHaveBeenCalledWith('kb-1');
      expect(routerMocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
        additionalSize: 4096,
        targetUserId: 'test-user',
        targetWorkspaceId: null,
      });
      expect(mockKnowledgeBaseModelTransferTo).toHaveBeenCalledWith('kb-1', null, 'test-user');
    });

    it('returns a stable error code when the library no longer exists', async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue(undefined);

      await expect(
        caller.transferKnowledgeBase({
          id: 'missing-kb',
          targetWorkspaceId: null,
        }),
      ).rejects.toMatchObject({
        cause: {
          data: {
            code: TransferErrorCode.ResourceNotFound,
          },
        },
      });
    });
  });

  describe('copyKnowledgeBaseToWorkspace', () => {
    it('checks target storage before copying a library', async () => {
      await caller.copyKnowledgeBaseToWorkspace({
        id: 'kb-1',
        targetWorkspaceId: null,
      });

      expect(mockKnowledgeBaseModelCountFileUsage).toHaveBeenCalledWith('kb-1');
      expect(routerMocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
        additionalSize: 4096,
        targetUserId: 'test-user',
        targetWorkspaceId: null,
      });
      expect(mockKnowledgeBaseModelCopyToWorkspace).toHaveBeenCalledWith('kb-1', null, 'test-user');
    });
  });
});
