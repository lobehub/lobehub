import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileUploadService } from './file.service';
import { KnowledgeBaseService } from './knowledge-base.service';

const mocks = vi.hoisted(() => ({
  trashFiles: vi.fn(),
  trashKnowledgeBases: vi.fn(),
}));

vi.mock('@/server/services/trash', () => ({
  TrashService: vi.fn().mockImplementation(() => mocks),
}));
vi.mock('@/server/modules/S3', () => ({ FileS3: vi.fn() }));
vi.mock('@/server/services/document', () => ({ DocumentService: vi.fn() }));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/knowledgeBase', () => ({ KnowledgeBaseModel: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({ RbacModel: vi.fn() }));
vi.mock('@lobechat/database', () => ({
  buildWorkspacePayload: vi.fn(),
  buildWorkspaceWhere: vi.fn(),
}));

interface FileUploadServiceInternals {
  findFileByIdWithPermission: (id: string, permission: unknown) => Promise<{ id: string }>;
  resolveOperationPermission: (
    action: string,
    target: unknown,
  ) => Promise<{ isPermitted: boolean }>;
}

interface KnowledgeBaseServiceInternals {
  resolveOperationPermission: (action: string) => Promise<{ isPermitted: boolean }>;
}

describe('OpenAPI Resource Trash deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trashFiles.mockResolvedValue([]);
    mocks.trashKnowledgeBases.mockResolvedValue([]);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('routes file deletion through Trash without deleting storage eagerly', async () => {
    const service = new FileUploadService({} as never, 'user-1', 'workspace-1');
    const internals = service as unknown as FileUploadServiceInternals;
    vi.spyOn(internals, 'resolveOperationPermission').mockResolvedValue({ isPermitted: true });
    vi.spyOn(internals, 'findFileByIdWithPermission').mockResolvedValue({ id: 'file-1' });

    await service.deleteFile('file-1');

    expect(mocks.trashFiles).toHaveBeenCalledWith(['file-1']);
  });

  it('routes knowledge base deletion through Trash', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'kb-1', userId: 'user-1' });
    const service = new KnowledgeBaseService(
      { query: { knowledgeBases: { findFirst } } } as never,
      'user-1',
      'workspace-1',
    );
    const internals = service as unknown as KnowledgeBaseServiceInternals;
    vi.spyOn(internals, 'resolveOperationPermission').mockResolvedValue({ isPermitted: true });

    await service.deleteKnowledgeBase('kb-1');

    expect(mocks.trashKnowledgeBases).toHaveBeenCalledWith(['kb-1']);
  });
});
