// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanPerformResourceAction: vi.fn(),
  deleteDocument: vi.fn(),
  findById: vi.fn(),
  removeAll: vi.fn(),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({ findById: mocks.findById })),
}));
vi.mock('@/database/models/resourcePermission', () => ({
  ResourcePermissionModel: vi.fn(() => ({ removeAll: mocks.removeAll })),
}));
vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(() => ({})),
}));
vi.mock('@/server/services/notebook', () => ({
  NotebookRuntimeService: vi.fn(() => ({ deleteDocument: mocks.deleteDocument })),
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource: vi.fn(),
  assertCanPerformResourceAction: mocks.assertCanPerformResourceAction,
}));

const { notebookRouter } = await import('../notebook');

describe('notebookRouter deleteDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanPerformResourceAction.mockResolvedValue(undefined);
    mocks.deleteDocument.mockResolvedValue(undefined);
    mocks.findById.mockResolvedValue({ id: 'doc-1' });
  });

  it('preserves workspace document ACLs while the document is restorable', async () => {
    const caller = notebookRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await caller.deleteDocument({ id: 'doc-1' });

    expect(mocks.deleteDocument).toHaveBeenCalledWith('doc-1', { restrictToCreator: true });
    expect(mocks.removeAll).not.toHaveBeenCalled();
  });
});
