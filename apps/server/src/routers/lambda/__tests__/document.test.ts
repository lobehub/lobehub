// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DOCUMENT_FOLDER_TYPE } from '@/database/schemas';
import { TransferErrorCode } from '@/types/transferError';

const mocks = vi.hoisted(() => ({
  assertCanEditResource: vi.fn(),
  assertCanPerformResourceAction: vi.fn(),
  businessFileTransferStorageCheck: vi.fn(),
  countFileUsageInSubtree: vi.fn(),
  createDocument: vi.fn(),
  findById: vi.fn(),
  findBySlug: vi.fn(),
  getAccessLevel: vi.fn(),
  getResourceMeta: vi.fn(),
  publishToWorkspace: vi.fn(),
  setAccessLevel: vi.fn(),
  subtreeHasForeignRows: vi.fn(),
  transferTo: vi.fn(),
  updateDocument: vi.fn(),
}));

vi.mock('@/business/server/lambda-routers/file', () => ({
  businessFileTransferStorageCheck: mocks.businessFileTransferStorageCheck,
}));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn(() => ({})) }));
vi.mock('@/database/models/document', async (importOriginal) => ({
  DOCUMENT_TRANSFER_FOREIGN_ROWS: ((await importOriginal()) as Record<string, string>)
    .DOCUMENT_TRANSFER_FOREIGN_ROWS,
  DocumentModel: vi.fn(() => ({
    countFileUsageInSubtree: mocks.countFileUsageInSubtree,
    findById: mocks.findById,
    findBySlug: mocks.findBySlug,
    subtreeHasForeignRows: mocks.subtreeHasForeignRows,
    transferTo: mocks.transferTo,
  })),
}));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn(() => ({})) }));
vi.mock('@/database/models/message', () => ({ MessageModel: vi.fn(() => ({})) }));
vi.mock('@/database/models/resourcePermission', () => ({
  ResourcePermissionModel: vi.fn(() => ({
    getAccessLevel: mocks.getAccessLevel,
    removeAll: vi.fn(),
    setAccessLevel: mocks.setAccessLevel,
  })),
}));
vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn(() => ({
    createDocument: mocks.createDocument,
    publishToWorkspace: mocks.publishToWorkspace,
    updateDocument: mocks.updateDocument,
  })),
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource: mocks.assertCanEditResource,
  assertCanPerformResourceAction: mocks.assertCanPerformResourceAction,
  buildResourcePermissionState: vi.fn(),
  getResourceMeta: mocks.getResourceMeta,
}));
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: vi.fn(),
}));

const { DOCUMENT_TRANSFER_FOREIGN_ROWS } = await import('@/database/models/document');
const { documentRouter } = await import('../document');

describe('documentRouter transferDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanPerformResourceAction.mockResolvedValue(undefined);
    mocks.assertCanEditResource.mockResolvedValue(undefined);
    mocks.findById.mockResolvedValue({
      id: 'doc-1',
      parentId: 'old-parent',
      userId: 'member-1',
      visibility: 'public',
      workspaceId: 'ws-1',
    });
    mocks.getResourceMeta.mockResolvedValue({
      userId: 'creator-1',
      visibility: 'public',
      workspaceId: 'ws-1',
    });
    mocks.subtreeHasForeignRows.mockResolvedValue(false);
  });

  it('blocks a non-owner from transferring a tree containing foreign rows', async () => {
    // The guard now runs INSIDE the transfer transaction (after row locks), so
    // the model rejects rather than a router preflight short-circuiting.
    mocks.transferTo.mockRejectedValueOnce(new Error(DOCUMENT_TRANSFER_FOREIGN_ROWS));
    const caller = documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await expect(
      caller.transferDocument({ documentId: 'doc-1', targetWorkspaceId: null }),
    ).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.OwnerOnly } },
      code: 'FORBIDDEN',
    });

    expect(mocks.transferTo).toHaveBeenCalledWith('doc-1', null, 'member-1', undefined, {
      forbidForeignRows: true,
    });
  });

  it('checks edit access on both the source and destination parents before moving a document', async () => {
    mocks.assertCanEditResource
      .mockResolvedValueOnce(undefined) // the document itself
      .mockResolvedValueOnce(undefined) // the current (source) parent
      .mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' })); // the destination parent
    const caller = documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await expect(
      caller.updateDocument({ id: 'doc-1', parentId: 'view-only-folder' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(mocks.findById).toHaveBeenCalledWith('doc-1');
    expect(mocks.assertCanEditResource).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        resourceId: 'old-parent',
        resourceType: 'document',
        workspaceId: 'ws-1',
      }),
    );
    expect(mocks.assertCanEditResource).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        resourceId: 'view-only-folder',
        resourceType: 'document',
        workspaceId: 'ws-1',
      }),
    );
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it('checks edit access on the source parent when detaching a document (parentId: null)', async () => {
    mocks.assertCanEditResource
      .mockResolvedValueOnce(undefined) // the document itself
      .mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' })); // the current parent
    const caller = documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await expect(caller.updateDocument({ id: 'doc-1', parentId: null })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    expect(mocks.assertCanEditResource).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ resourceId: 'old-parent', resourceType: 'document' }),
    );
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it('does not re-check the parent when an ordinary update includes the current parent', async () => {
    const caller = documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await caller.updateDocument({ id: 'doc-1', parentId: 'old-parent', title: 'Renamed' });

    expect(mocks.assertCanEditResource).toHaveBeenCalledTimes(1);
    expect(mocks.updateDocument).toHaveBeenCalledWith('doc-1', {
      editorData: undefined,
      parentId: 'old-parent',
      title: 'Renamed',
    });
  });
});

describe('documentRouter createDocument under a knowledge-base folder', () => {
  const caller = () =>
    documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);
  const kbFolder = { fileType: DOCUMENT_FOLDER_TYPE, knowledgeBaseId: 'kb-1', metadata: null };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanPerformResourceAction.mockResolvedValue(undefined);
    mocks.assertCanEditResource.mockResolvedValue(undefined);
    mocks.findBySlug.mockResolvedValue(undefined);
    // The parent folder was created by another member inside a public KB.
    mocks.getResourceMeta.mockResolvedValue({
      userId: 'creator-1',
      visibility: 'public',
      workspaceId: 'ws-1',
    });
    mocks.createDocument.mockResolvedValue({ id: 'docs_new', visibility: 'public' });
  });

  it('authorizes through the KB instead of the folder ACL for a KB-scoped parent', async () => {
    mocks.findById.mockResolvedValue({ id: 'folder-1', ...kbFolder });

    await caller().createDocument({ parentId: 'folder-1', title: 'Doc' });

    // The KB browse permission is the authority — the folder's own (default
    // `view`) document ACL must not be consulted, or every non-creator member
    // gets locked out of the folder.
    expect(mocks.assertCanEditResource).not.toHaveBeenCalled();
    expect(mocks.assertCanPerformResourceAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'view',
        resourceId: 'kb-1',
        resourceType: 'knowledgeBase',
      }),
    );
    expect(mocks.createDocument).toHaveBeenCalled();
  });

  it('reads the KB id from metadata for legacy folders without the column', async () => {
    mocks.findById.mockResolvedValue({
      fileType: DOCUMENT_FOLDER_TYPE,
      id: 'folder-1',
      knowledgeBaseId: null,
      metadata: { knowledgeBaseId: 'kb-1' },
    });

    await caller().createDocument({ parentId: 'folder-1', title: 'Doc' });

    expect(mocks.assertCanEditResource).not.toHaveBeenCalled();
    expect(mocks.assertCanPerformResourceAction).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'kb-1', resourceType: 'knowledgeBase' }),
    );
  });

  it('still denies when the KB itself is not browsable (restricted KB)', async () => {
    mocks.findById.mockResolvedValue({ id: 'folder-1', ...kbFolder });
    mocks.assertCanPerformResourceAction.mockRejectedValueOnce(
      new TRPCError({ code: 'FORBIDDEN' }),
    );

    await expect(
      caller().createDocument({ parentId: 'folder-1', title: 'Doc' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.createDocument).not.toHaveBeenCalled();
  });

  it('keeps the folder document ACL check for a non-KB workspace parent', async () => {
    mocks.findById.mockResolvedValue({
      fileType: DOCUMENT_FOLDER_TYPE,
      id: 'folder-1',
      knowledgeBaseId: null,
      metadata: null,
    });

    await caller().createDocument({ parentId: 'folder-1', title: 'Doc' });

    expect(mocks.assertCanEditResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'folder-1', resourceType: 'document' }),
    );
  });

  it("keeps the document ACL for another member's KB page used as the parent", async () => {
    // Pages inside a KB carry the same knowledgeBaseId as folders; only real
    // folders may take the KB route, otherwise a view-only page's ACL is skipped.
    mocks.findById.mockResolvedValue({
      fileType: 'custom/document',
      id: 'page-1',
      knowledgeBaseId: 'kb-1',
      metadata: null,
    });
    mocks.assertCanEditResource.mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' }));

    await expect(
      caller().createDocument({ parentId: 'page-1', title: 'Doc' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.assertCanEditResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'page-1', resourceType: 'document' }),
    );
    expect(mocks.assertCanPerformResourceAction).not.toHaveBeenCalled();
    expect(mocks.createDocument).not.toHaveBeenCalled();
  });

  it("keeps another member's private KB folder creator-only", async () => {
    mocks.getResourceMeta.mockResolvedValue({
      userId: 'creator-1',
      visibility: 'private',
      workspaceId: 'ws-1',
    });
    mocks.findById.mockResolvedValue({ id: 'folder-1', ...kbFolder });
    mocks.assertCanEditResource.mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' }));

    await expect(
      caller().createDocument({ parentId: 'folder-1', title: 'Doc' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Private foreign parents never take the KB bypass.
    expect(mocks.assertCanPerformResourceAction).not.toHaveBeenCalled();
    expect(mocks.createDocument).not.toHaveBeenCalled();
  });

  it('authorizes a move into a KB folder through the KB as well', async () => {
    mocks.findById.mockImplementation(async (id: string) =>
      id === 'doc-1'
        ? {
            id: 'doc-1',
            parentId: null,
            userId: 'member-1',
            visibility: 'public',
            workspaceId: 'ws-1',
          }
        : { id, ...kbFolder },
    );

    await caller().updateDocument({ id: 'doc-1', parentId: 'kb-folder' });

    // Only the document itself goes through the document edit guard; the
    // destination folder is authorized through its KB.
    expect(mocks.assertCanEditResource).toHaveBeenCalledTimes(1);
    expect(mocks.assertCanEditResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'doc-1' }),
    );
    expect(mocks.assertCanPerformResourceAction).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'kb-1', resourceType: 'knowledgeBase' }),
    );
    expect(mocks.updateDocument).toHaveBeenCalled();
  });
});

describe('documentRouter publishDocumentToWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanPerformResourceAction.mockResolvedValue(undefined);
    mocks.findById.mockResolvedValue({
      id: 'doc-1',
      userId: 'creator-1',
      visibility: 'private',
      workspaceId: 'ws-1',
    });
    mocks.publishToWorkspace.mockResolvedValue({ documentIds: ['doc-1'] });
  });

  const caller = () =>
    documentRouter.createCaller({
      serverDB: {},
      userId: 'creator-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

  it('preserves an access level staged while the document was private', async () => {
    mocks.getAccessLevel.mockResolvedValue('edit');

    await caller().publishDocumentToWorkspace({ id: 'doc-1' });

    expect(mocks.setAccessLevel).toHaveBeenCalledWith('document', 'doc-1', 'edit', 'creator-1');
  });

  it('falls back to the default level when nothing was staged', async () => {
    mocks.getAccessLevel.mockResolvedValue(null);

    await caller().publishDocumentToWorkspace({ id: 'doc-1' });

    expect(mocks.setAccessLevel).toHaveBeenCalledWith('document', 'doc-1', 'view', 'creator-1');
  });

  it('lets an explicit input override a staged level', async () => {
    mocks.getAccessLevel.mockResolvedValue('view');

    await caller().publishDocumentToWorkspace({ accessLevel: 'edit', id: 'doc-1' });

    expect(mocks.setAccessLevel).toHaveBeenCalledWith('document', 'doc-1', 'edit', 'creator-1');
  });
});
