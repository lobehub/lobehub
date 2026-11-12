import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeBaseRouter } from '@/server/routers/lambda/knowledgeBase';
import { TransferErrorCode } from '@/types/transferError';

const publicMemberKnowledgeBase = () => ({
  id: 'kb-1',
  userId: 'another-member',
  visibility: 'public',
  workspaceId: 'workspace-active',
});

const routerMocks = vi.hoisted(() => ({
  assertContentsNotInRestrictedKnowledgeBase: vi.fn(),
  assertKnowledgeBaseBrowsable: vi.fn(),
  assertCanPerformResourceAction: vi.fn(),
  businessFileTransferStorageCheck: vi.fn(),
  filterRestrictedKnowledgeBases: vi.fn(async (_ctx: unknown, items: unknown) => items),
  hasWorkspaceScopedPermission: vi.fn(),
  scopedPermission: vi.fn(),
}));

const mockKnowledgeBaseModelCountFileUsage = vi.fn();
const mockKnowledgeBaseModelAddFiles = vi.fn();
const mockKnowledgeBaseModelCopyToWorkspace = vi.fn();
const mockKnowledgeBaseModelDeleteWithFiles = vi.fn();
const mockKnowledgeBaseModelFindById = vi.fn();
const mockKnowledgeBaseModelQuery = vi.fn();
const mockKnowledgeRepoReorderItems = vi.fn();
const mockKnowledgeBaseModelRemoveFiles = vi.fn();
const mockKnowledgeBaseModelTransferTo = vi.fn();
const mockKnowledgeBaseModelHasForeignLinkedRows = vi.fn().mockResolvedValue(false);
const mockKnowledgeBaseModelUpdate = vi.fn();
const mockDocumentModelFindByIds = vi.fn();
const mockFileModelFindByIds = vi.fn();

const agentSpaceMocks = vi.hoisted(() => ({ flags: vi.fn(), list: vi.fn() }));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    withScopedPermission: (action: string) =>
      trpc.middleware(async (opts) => {
        await routerMocks.scopedPermission(action);
        return opts.next();
      }),
  };
});

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: agentSpaceMocks.flags,
}));

vi.mock('@/database/repositories/agentSpace', () => ({
  AgentSpaceRepository: class {
    list = agentSpaceMocks.list;
  },
}));

vi.mock('@/business/server/lambda-routers/file', () => ({
  businessFileTransferStorageCheck: routerMocks.businessFileTransferStorageCheck,
}));

vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: routerMocks.hasWorkspaceScopedPermission,
}));

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: routerMocks.assertCanPerformResourceAction,
}));

vi.mock('@/server/routers/lambda/_helpers/knowledgeBaseAccess', () => ({
  assertContentsNotInRestrictedKnowledgeBase:
    routerMocks.assertContentsNotInRestrictedKnowledgeBase,
  assertKnowledgeBaseBrowsable: routerMocks.assertKnowledgeBaseBrowsable,
  filterRestrictedKnowledgeBases: routerMocks.filterRestrictedKnowledgeBases,
  getUseLevelKnowledgeBaseIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return { findByIds: mockDocumentModelFindByIds };
  }),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return { findByIds: mockFileModelFindByIds };
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { deleteFiles: vi.fn() };
  }),
}));

const mockPermissionRemoveAll = vi.fn();
const mockPermissionSetAccessLevel = vi.fn();
vi.mock('@/database/models/resourcePermission', () => ({
  ResourcePermissionModel: vi.fn(function () {
    return {
      removeAll: mockPermissionRemoveAll,
      setAccessLevel: mockPermissionSetAccessLevel,
    };
  }),
}));

vi.mock('@/database/repositories/knowledge', () => ({
  KnowledgeRepo: vi.fn(function () {
    return { reorderItems: mockKnowledgeRepoReorderItems };
  }),
}));

vi.mock('@/database/models/knowledgeBase', () => ({
  KnowledgeBaseModel: vi.fn(function () {
    return {
      addFilesToKnowledgeBase: mockKnowledgeBaseModelAddFiles,
      copyToWorkspace: mockKnowledgeBaseModelCopyToWorkspace,
      countFileUsage: mockKnowledgeBaseModelCountFileUsage,
      deleteWithFiles: mockKnowledgeBaseModelDeleteWithFiles,
      findById: mockKnowledgeBaseModelFindById,
      hasForeignLinkedRows: mockKnowledgeBaseModelHasForeignLinkedRows,
      query: mockKnowledgeBaseModelQuery,
      removeFilesFromKnowledgeBase: mockKnowledgeBaseModelRemoveFiles,
      transferTo: mockKnowledgeBaseModelTransferTo,
      update: mockKnowledgeBaseModelUpdate,
    };
  }),
}));

describe('knowledgeBaseRouter', () => {
  const ctx = {
    serverDB: {},
    userId: 'test-user',
    workspaceId: 'workspace-active',
    workspaceRole: 'member',
  };

  const caller = knowledgeBaseRouter.createCaller(ctx as any);

  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.scopedPermission.mockResolvedValue(undefined);
    routerMocks.assertContentsNotInRestrictedKnowledgeBase.mockResolvedValue(undefined);
    routerMocks.assertKnowledgeBaseBrowsable.mockResolvedValue(undefined);
    routerMocks.assertCanPerformResourceAction.mockResolvedValue(undefined);
    routerMocks.businessFileTransferStorageCheck.mockResolvedValue(undefined);
    routerMocks.hasWorkspaceScopedPermission.mockResolvedValue(true);
    mockKnowledgeBaseModelCopyToWorkspace.mockResolvedValue({ id: 'kb-copy' });
    mockKnowledgeBaseModelCountFileUsage.mockResolvedValue(4096);
    mockKnowledgeBaseModelDeleteWithFiles.mockResolvedValue({ deletedFiles: [] });
    mockKnowledgeBaseModelFindById.mockResolvedValue({
      id: 'kb-1',
      userId: 'test-user',
      visibility: 'public',
      workspaceId: 'workspace-active',
    });
    mockKnowledgeBaseModelQuery.mockResolvedValue([]);
    mockKnowledgeBaseModelTransferTo.mockResolvedValue({ id: 'kb-1' });
    mockKnowledgeBaseModelUpdate.mockResolvedValue({ id: 'kb-1' });
  });

  describe('reorderKnowledgeItems', () => {
    const input = {
      knowledgeBaseId: 'kb-1',
      dragIds: ['docs_page'],
      targetId: 'file_raw',
      position: 'before' as const,
      parentId: null,
      sorter: 'custom' as const,
      sortType: 'desc' as const,
    };

    beforeEach(() => {
      mockDocumentModelFindByIds.mockResolvedValue([{ id: 'docs_page' }]);
      mockFileModelFindByIds.mockResolvedValue([{ id: 'file_raw' }]);
      mockKnowledgeRepoReorderItems.mockResolvedValue({ success: true });
    });

    it('checks edit permission and resource access before persisting the order', async () => {
      expect(await caller.reorderKnowledgeItems(input)).toEqual({ success: true });
      expect(routerMocks.scopedPermission).toHaveBeenCalledWith('knowledge_base:update');
      expect(routerMocks.assertKnowledgeBaseBrowsable).toHaveBeenCalledWith(
        expect.anything(),
        'kb-1',
        {
          userId: 'test-user',
          visibility: 'public',
          workspaceId: 'workspace-active',
        },
      );
      expect(routerMocks.assertContentsNotInRestrictedKnowledgeBase).toHaveBeenCalledWith(
        expect.anything(),
        [...input.dragIds, input.targetId],
      );
      expect(mockKnowledgeRepoReorderItems).toHaveBeenCalledWith(input);
    });

    it('rejects a missing KB before writing', async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue(undefined);
      await expect(caller.reorderKnowledgeItems(input)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(mockKnowledgeRepoReorderItems).not.toHaveBeenCalled();
    });

    it('rejects inaccessible resources before writing', async () => {
      mockDocumentModelFindByIds.mockResolvedValue([]);
      await expect(caller.reorderKnowledgeItems(input)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(mockKnowledgeRepoReorderItems).not.toHaveBeenCalled();
    });

    it.each(['permission', 'library', 'contents'])(
      'rejects denied %s access before writing',
      async (gate) => {
        const denied = new TRPCError({ code: 'FORBIDDEN' });
        if (gate === 'permission') routerMocks.scopedPermission.mockRejectedValueOnce(denied);
        if (gate === 'library')
          routerMocks.assertKnowledgeBaseBrowsable.mockRejectedValueOnce(denied);
        if (gate === 'contents')
          routerMocks.assertContentsNotInRestrictedKnowledgeBase.mockRejectedValueOnce(denied);
        await expect(caller.reorderKnowledgeItems(input)).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        expect(mockKnowledgeRepoReorderItems).not.toHaveBeenCalled();
      },
    );

    it.each([{ dragIds: [] }, { dragIds: Array.from({ length: 10_001 }, (_, i) => `file_${i}`) }])(
      'rejects an invalid order length',
      async ({ dragIds }) => {
        await expect(caller.reorderKnowledgeItems({ ...input, dragIds })).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
        expect(mockKnowledgeRepoReorderItems).not.toHaveBeenCalled();
      },
    );
  });

  describe('updateKnowledgeBase', () => {
    it("lets a member update another member's visible shared library", async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue(publicMemberKnowledgeBase());

      await caller.updateKnowledgeBase({ id: 'kb-1', value: { name: 'Updated library' } });

      expect(routerMocks.assertKnowledgeBaseBrowsable).toHaveBeenCalledWith(
        expect.anything(),
        'kb-1',
        expect.objectContaining({ userId: 'another-member', visibility: 'public' }),
      );
      expect(mockKnowledgeBaseModelUpdate).toHaveBeenCalledWith('kb-1', {
        name: 'Updated library',
      });
    });

    // Regression: the input used to be `insertKnowledgeBasesSchema.partial()`,
    // so a member with collaborative `edit` access could reassign the row, move
    // it to another workspace, or take it private through the rename endpoint.
    it('drops identity and scope fields from the update payload', async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue(publicMemberKnowledgeBase());

      await caller.updateKnowledgeBase({
        id: 'kb-1',
        value: {
          description: 'New description',
          id: 'hijacked-id',
          name: 'Updated library',
          userId: 'test-user',
          visibility: 'private',
          workspaceId: 'other-workspace',
        },
      } as Parameters<typeof caller.updateKnowledgeBase>[0]);

      expect(mockKnowledgeBaseModelUpdate).toHaveBeenCalledWith('kb-1', {
        description: 'New description',
        name: 'Updated library',
      });
    });

    it('merges a cover into the stored settings without dropping other settings', async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue({
        id: 'kb-1',
        settings: { cover: 'preset:old', topK: 5 },
        userId: 'test-user',
        visibility: 'public',
        workspaceId: 'workspace-active',
      });

      await caller.updateKnowledgeBase({ id: 'kb-1', value: { cover: 'preset:aurora' } });

      expect(mockKnowledgeBaseModelUpdate).toHaveBeenCalledWith('kb-1', {
        settings: { cover: 'preset:aurora', topK: 5 },
      });
    });

    it('clears the cover back to the generated default on null', async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue({
        id: 'kb-1',
        settings: { cover: 'preset:old', topK: 5 },
        userId: 'test-user',
        visibility: 'public',
        workspaceId: 'workspace-active',
      });

      await caller.updateKnowledgeBase({ id: 'kb-1', value: { cover: null } });

      expect(mockKnowledgeBaseModelUpdate).toHaveBeenCalledWith('kb-1', {
        settings: { topK: 5 },
      });
    });

    it('does not update a restricted library that the member cannot browse', async () => {
      routerMocks.assertKnowledgeBaseBrowsable.mockRejectedValue(new Error('denied'));

      await expect(
        caller.updateKnowledgeBase({ id: 'kb-1', value: { name: 'Updated library' } }),
      ).rejects.toThrow('denied');

      expect(mockKnowledgeBaseModelUpdate).not.toHaveBeenCalled();
    });
  });

  describe('addFilesToKnowledgeBase', () => {
    it("lets a member add another creator's visible resource", async () => {
      mockFileModelFindByIds.mockResolvedValue([{ id: 'file-1', visibility: 'public' }]);
      mockDocumentModelFindByIds.mockResolvedValue([]);
      mockKnowledgeBaseModelAddFiles.mockResolvedValue([{ fileId: 'file-1' }]);

      await caller.addFilesToKnowledgeBase({ ids: ['file-1'], knowledgeBaseId: 'kb-1' });

      expect(mockKnowledgeBaseModelAddFiles).toHaveBeenCalledWith('kb-1', ['file-1']);
    });

    it('files a private resource into a shared library', async () => {
      // A library is a directory of references, so it does not force its rows
      // to share its visibility: filing a draft now and sharing it when it is
      // ready is the ordinary move. Who sees the row is still decided by the
      // row's own `visibility`, which every listing filters on.
      mockFileModelFindByIds.mockResolvedValue([{ id: 'file-1', visibility: 'private' }]);
      mockDocumentModelFindByIds.mockResolvedValue([]);

      await caller.addFilesToKnowledgeBase({ ids: ['file-1'], knowledgeBaseId: 'kb-1' });

      expect(mockKnowledgeBaseModelAddFiles).toHaveBeenCalledWith('kb-1', ['file-1']);
    });

    it('fails the whole batch when any resource is inaccessible', async () => {
      mockFileModelFindByIds.mockResolvedValue([{ id: 'file-1', visibility: 'public' }]);
      mockDocumentModelFindByIds.mockResolvedValue([]);

      await expect(
        caller.addFilesToKnowledgeBase({
          ids: ['file-1', 'private-file'],
          knowledgeBaseId: 'kb-1',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockKnowledgeBaseModelAddFiles).not.toHaveBeenCalled();
    });
  });

  describe('getAgentSpaces', () => {
    it('stays empty while the rollout flag is off', async () => {
      agentSpaceMocks.flags.mockResolvedValue({ enableAgentKnowledgeSpace: false });

      await expect(caller.getAgentSpaces()).resolves.toEqual([]);
      expect(agentSpaceMocks.list).not.toHaveBeenCalled();
    });

    it('lists agent spaces once the flag is on', async () => {
      agentSpaceMocks.flags.mockResolvedValue({ enableAgentKnowledgeSpace: true });
      agentSpaceMocks.list.mockResolvedValue([{ id: 'kb-agent' }]);

      await expect(caller.getAgentSpaces()).resolves.toEqual([{ id: 'kb-agent' }]);
    });

    it('drops spaces the caller is restricted from browsing', async () => {
      agentSpaceMocks.flags.mockResolvedValue({ enableAgentKnowledgeSpace: true });
      agentSpaceMocks.list.mockResolvedValue([{ id: 'kb-agent' }, { id: 'kb-restricted' }]);
      routerMocks.filterRestrictedKnowledgeBases.mockImplementationOnce(async (_ctx, items) =>
        (items as { id: string }[]).filter((item) => item.id !== 'kb-restricted'),
      );

      await expect(caller.getAgentSpaces()).resolves.toEqual([{ id: 'kb-agent' }]);
    });
  });

  describe('removeKnowledgeBase', () => {
    it("lets a member delete another creator's visible library", async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue(publicMemberKnowledgeBase());

      await caller.removeKnowledgeBase({ id: 'kb-1' });

      expect(mockKnowledgeBaseModelDeleteWithFiles).toHaveBeenCalledWith(
        'kb-1',
        expect.any(Boolean),
      );
    });

    it("refuses to delete an agent's dedicated space", async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue({
        ...publicMemberKnowledgeBase(),
        type: 'agent',
      });

      await expect(caller.removeKnowledgeBase({ id: 'kb-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mockKnowledgeBaseModelDeleteWithFiles).not.toHaveBeenCalled();
    });
  });

  describe('transferKnowledgeBase', () => {
    it('checks storage and clears source permissions when transferring to personal scope', async () => {
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
      expect(mockKnowledgeBaseModelTransferTo).toHaveBeenCalledWith(
        'kb-1',
        null,
        'test-user',
        undefined,
      );
      expect(mockPermissionRemoveAll).toHaveBeenCalledWith('knowledgeBase', 'kb-1');
      expect(mockPermissionSetAccessLevel).not.toHaveBeenCalled();
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

  describe('transferKnowledgeBase permission rows', () => {
    it('removes the source-workspace row and seeds the default level in a public target', async () => {
      await caller.transferKnowledgeBase({
        id: 'kb-1',
        targetVisibility: 'public',
        targetWorkspaceId: 'workspace-target',
      });

      expect(mockPermissionRemoveAll).toHaveBeenCalledWith('knowledgeBase', 'kb-1');
      expect(mockPermissionSetAccessLevel).toHaveBeenCalledWith(
        'knowledgeBase',
        'kb-1',
        'edit',
        'test-user',
      );
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
      expect(mockKnowledgeBaseModelCopyToWorkspace).toHaveBeenCalledWith(
        'kb-1',
        null,
        'test-user',
        undefined,
      );
    });

    it("rejects copying another member's library before any target or storage side effects", async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue({
        id: 'kb-1',
        userId: 'another-member',
      });

      await expect(
        caller.copyKnowledgeBaseToWorkspace({
          id: 'kb-1',
          targetWorkspaceId: 'workspace-target',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(routerMocks.hasWorkspaceScopedPermission).not.toHaveBeenCalled();
      expect(mockKnowledgeBaseModelCountFileUsage).not.toHaveBeenCalled();
      expect(routerMocks.businessFileTransferStorageCheck).not.toHaveBeenCalled();
      expect(mockKnowledgeBaseModelCopyToWorkspace).not.toHaveBeenCalled();
    });

    it('rejects target workspace copy when RBAC denies knowledge base creation', async () => {
      routerMocks.hasWorkspaceScopedPermission.mockResolvedValue(false);

      await expect(
        caller.copyKnowledgeBaseToWorkspace({
          id: 'kb-1',
          targetWorkspaceId: 'workspace-target',
        }),
      ).rejects.toMatchObject({
        cause: {
          data: {
            code: TransferErrorCode.TargetNoWriteAccess,
          },
        },
      });

      expect(routerMocks.businessFileTransferStorageCheck).not.toHaveBeenCalled();
      expect(mockKnowledgeBaseModelCopyToWorkspace).not.toHaveBeenCalled();
    });
  });
});
