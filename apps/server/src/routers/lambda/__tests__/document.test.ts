// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DOCUMENT_FOLDER_TYPE } from '@/database/schemas';
import { TransferErrorCode } from '@/types/transferError';

const mocks = vi.hoisted(() => ({
  assertContentsNotInRestrictedKnowledgeBase: vi.fn(),
  assertCanEditResource: vi.fn(),
  assertCanPerformResourceAction: vi.fn(),
  businessFileTransferStorageCheck: vi.fn(),
  countFileUsageInSubtree: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  deleteDocuments: vi.fn(),
  findById: vi.fn(),
  findByIds: vi.fn(),
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
    findByIds: mocks.findByIds,
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
    deleteDocument: mocks.deleteDocument,
    deleteDocuments: mocks.deleteDocuments,
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
vi.mock('@/server/routers/lambda/_helpers/knowledgeBaseAccess', () => ({
  assertContentsNotInRestrictedKnowledgeBase: mocks.assertContentsNotInRestrictedKnowledgeBase,
  getRestrictedKnowledgeBaseIds: vi.fn().mockResolvedValue([]),
}));

const { DOCUMENT_TRANSFER_FOREIGN_ROWS } = await import('@/database/models/document');
const { documentRouter } = await import('../document');

describe('documentRouter transferDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanPerformResourceAction.mockResolvedValue(undefined);
    mocks.assertCanEditResource.mockResolvedValue(undefined);
    mocks.assertContentsNotInRestrictedKnowledgeBase.mockResolvedValue(undefined);
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

  it("lets a member move another creator's visible document between visible parents", async () => {
    const caller = documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await caller.updateDocument({ id: 'doc-1', parentId: 'shared-folder' });

    expect(mocks.findById).toHaveBeenCalledWith('doc-1');
    expect(mocks.getResourceMeta).toHaveBeenCalledTimes(2);
    expect(mocks.updateDocument).toHaveBeenCalledWith('doc-1', {
      editorData: undefined,
      parentId: 'shared-folder',
    });
  });

  it("rejects moving a document into another member's private parent", async () => {
    mocks.getResourceMeta
      .mockResolvedValueOnce({
        userId: 'creator-1',
        visibility: 'public',
        workspaceId: 'ws-1',
      })
      .mockResolvedValueOnce({
        userId: 'another-member',
        visibility: 'private',
        workspaceId: 'ws-1',
      });
    const caller = documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await expect(
      caller.updateDocument({ id: 'doc-1', parentId: 'private-folder' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

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

    expect(mocks.getResourceMeta).not.toHaveBeenCalled();
    expect(mocks.updateDocument).toHaveBeenCalledWith('doc-1', {
      editorData: undefined,
      parentId: 'old-parent',
      title: 'Renamed',
    });
  });

  it("lets a member delete another creator's visible document", async () => {
    const caller = documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await caller.deleteDocument({ id: 'doc-1' });

    expect(mocks.deleteDocument).toHaveBeenCalledWith('doc-1');
    expect(mocks.assertCanPerformResourceAction).not.toHaveBeenCalled();
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
    mocks.assertContentsNotInRestrictedKnowledgeBase.mockResolvedValue(undefined);
    mocks.findBySlug.mockResolvedValue(undefined);
    // The parent folder was created by another member inside a public KB.
    mocks.getResourceMeta.mockResolvedValue({
      userId: 'creator-1',
      visibility: 'public',
      workspaceId: 'ws-1',
    });
    mocks.createDocument.mockResolvedValue({ id: 'docs_new', visibility: 'public' });
  });

  it("lets a member create under another creator's visible parent", async () => {
    mocks.findById.mockResolvedValue({ id: 'folder-1', ...kbFolder });

    await caller().createDocument({ parentId: 'folder-1', title: 'Doc' });

    expect(mocks.assertContentsNotInRestrictedKnowledgeBase).toHaveBeenCalledWith(
      expect.anything(),
      ['folder-1'],
    );
    expect(mocks.createDocument).toHaveBeenCalled();
  });

  it('does not depend on legacy knowledge-base metadata to authorize the parent', async () => {
    mocks.findById.mockResolvedValue({
      fileType: DOCUMENT_FOLDER_TYPE,
      id: 'folder-1',
      knowledgeBaseId: null,
      metadata: { knowledgeBaseId: 'kb-1' },
    });

    await caller().createDocument({ parentId: 'folder-1', title: 'Doc' });

    expect(mocks.assertContentsNotInRestrictedKnowledgeBase).toHaveBeenCalledWith(
      expect.anything(),
      ['folder-1'],
    );
  });

  it('still denies when the KB itself is not browsable (restricted KB)', async () => {
    mocks.findById.mockResolvedValue({ id: 'folder-1', ...kbFolder });
    mocks.assertContentsNotInRestrictedKnowledgeBase.mockRejectedValueOnce(
      new TRPCError({ code: 'FORBIDDEN' }),
    );

    await expect(
      caller().createDocument({ parentId: 'folder-1', title: 'Doc' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.createDocument).not.toHaveBeenCalled();
  });

  it('uses the same visible-resource rule for a non-KB workspace parent', async () => {
    mocks.findById.mockResolvedValue({
      fileType: DOCUMENT_FOLDER_TYPE,
      id: 'folder-1',
      knowledgeBaseId: null,
      metadata: null,
    });

    await caller().createDocument({ parentId: 'folder-1', title: 'Doc' });

    expect(mocks.assertContentsNotInRestrictedKnowledgeBase).toHaveBeenCalledWith(
      expect.anything(),
      ['folder-1'],
    );
  });

  it("lets a member create under another member's visible KB page", async () => {
    mocks.findById.mockResolvedValue({
      fileType: 'custom/document',
      id: 'page-1',
      knowledgeBaseId: 'kb-1',
      metadata: null,
    });
    await caller().createDocument({ parentId: 'page-1', title: 'Doc' });

    expect(mocks.assertContentsNotInRestrictedKnowledgeBase).toHaveBeenCalledWith(
      expect.anything(),
      ['page-1'],
    );
    expect(mocks.createDocument).toHaveBeenCalled();
  });

  it("keeps another member's private KB folder creator-only", async () => {
    mocks.getResourceMeta.mockResolvedValue({
      userId: 'creator-1',
      visibility: 'private',
      workspaceId: 'ws-1',
    });
    mocks.findById.mockResolvedValue({ id: 'folder-1', ...kbFolder });
    await expect(
      caller().createDocument({ parentId: 'folder-1', title: 'Doc' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.assertContentsNotInRestrictedKnowledgeBase).not.toHaveBeenCalled();
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

    expect(mocks.assertContentsNotInRestrictedKnowledgeBase).toHaveBeenCalledWith(
      expect.anything(),
      ['doc-1'],
    );
    expect(mocks.assertContentsNotInRestrictedKnowledgeBase).toHaveBeenCalledWith(
      expect.anything(),
      ['kb-folder'],
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
