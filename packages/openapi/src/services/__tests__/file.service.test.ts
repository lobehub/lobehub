import { describe, expect, it, vi } from 'vitest';

import { DeletedResourceSchema } from '../../types/common.type';
import {
  FileChunkStatusResponseSchema,
  FileDetailSchema,
  FileUrlResponseSchema,
} from '../../types/file.type';
import { FileUploadService } from '../file.service';

// Only the collaborators the service builds in its constructor are stubbed;
// the projection and response assembly under test stay real.
vi.mock('@/database/models/rbac', () => ({ RbacModel: class {} }));
vi.mock('@/database/models/file', () => ({ FileModel: class {} }));
vi.mock('@/database/models/document', () => ({ DocumentModel: class {} }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: class {} }));
vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: class {} }));
vi.mock('@/database/models/knowledgeBase', () => ({ KnowledgeBaseModel: class {} }));
vi.mock('@/server/modules/S3', () => ({ FileS3: class {} }));
vi.mock('@/server/services/document', () => ({ DocumentService: class {} }));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('@/business/server/lambda-routers/file', () => ({ businessFileUploadCheck: vi.fn() }));

/** A full `files` row, private columns included, as the database returns it. */
const fileRow = {
  accessedAt: new Date('2024-01-03T00:00:00Z'),
  chunkTaskId: 'task-chunk',
  clientId: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  deletedAt: null,
  deletedBy: null,
  embeddingTaskId: null,
  fileHash: 'hash',
  fileType: 'image/png',
  id: 'file-1',
  metadata: { path: 'files/a.png' },
  name: 'a.png',
  parentId: null,
  size: 12,
  source: null,
  updatedAt: new Date('2024-01-02T00:00:00Z'),
  url: 'https://cdn.example.com/files/a.png',
  userId: 'user-1',
  visibility: 'public',
  workspaceId: null,
};

const buildService = () => {
  const service = new FileUploadService({} as any, 'user-1') as any;
  service.resolveOperationPermission = vi.fn().mockResolvedValue({ isPermitted: true });
  service.findFileByIdWithPermission = vi.fn().mockResolvedValue(fileRow);
  return service;
};

// Round-trip through JSON the way `c.json` does; `structuredClone` would keep the `Date` objects.
// oxlint-disable-next-line unicorn/prefer-structured-clone
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('FileUploadService response payloads', () => {
  // Regression: DELETE /files/:id answered with no `data` at all.
  it('reports the deleted file id', async () => {
    const service = buildService();
    service.coreFileService = { deleteFile: vi.fn() };
    service.fileModel = { delete: vi.fn() };

    const result = await service.deleteFile('file-1');

    expect(result).toEqual({ deleted: true, id: 'file-1' });
    expect(service.fileModel.delete).toHaveBeenCalledWith('file-1');
    expect(() => DeletedResourceSchema.parse(result)).not.toThrow();
  });

  it('returns only the public file columns in a file detail', async () => {
    const result = asJson(await buildService().getFileDetail('file-1'));

    expect(() => FileDetailSchema.parse(result)).not.toThrow();
    expect(result.file).not.toHaveProperty('userId');
  });

  it('matches the documented pre-signed URL payload', async () => {
    const service = buildService();
    service.s3Service = { createPreSignedUrlForPreview: vi.fn().mockResolvedValue('https://s') };

    const result = await service.getFileUrl('file-1', { expiresIn: 60 });

    expect(() => FileUrlResponseSchema.parse(result)).not.toThrow();
  });

  it('matches the documented chunk status payload', async () => {
    const service = buildService();
    service.chunkModel = { countByFileId: vi.fn().mockResolvedValue(3) };
    service.asyncTaskModel = {
      findById: vi.fn().mockResolvedValue({
        error: { body: { detail: 'boom' }, name: 'ChunkError' },
        id: 'task-chunk',
        status: 'error',
      }),
    };

    const result = asJson(await service.getFileChunkStatus('file-1'));

    expect(() => FileChunkStatusResponseSchema.parse(result)).not.toThrow();
  });
});
