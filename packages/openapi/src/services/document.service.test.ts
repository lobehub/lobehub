import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import { updateDocumentFromInput } from '@/server/services/document/writeFlow';
import { getDocumentForViewer } from '@/server/services/documentAccess';

import { DocumentRestService } from './document.service';

const findById = vi.fn();

vi.mock('@/database/models/rbac', () => ({ RbacModel: class {} }));
vi.mock('@/database/models/document', () => ({
  DocumentModel: class {
    findById = findById;
  },
}));
vi.mock('@/server/services/document', () => ({ DocumentService: class {} }));
vi.mock('@/server/services/document/writeFlow', () => ({
  createDocumentFromInput: vi.fn(),
  updateDocumentFromInput: vi.fn(),
}));
vi.mock('@/server/services/documentAccess', () => ({ getDocumentForViewer: vi.fn() }));
vi.mock('@/server/services/knowledgeBaseAccess', () => ({
  assertContentsNotInRestrictedKnowledgeBase: vi.fn(),
  getRestrictedKnowledgeBaseIds: vi.fn(async () => []),
}));

const storedDocument = {
  content: 'New body',
  createdAt: new Date('2026-11-19T01:00:00Z'),
  fileType: 'custom/document',
  id: 'doc-1',
  parentId: 'folder-1',
  slug: null,
  title: 'Weekly sync',
  updatedAt: new Date('2026-11-19T02:00:00Z'),
};

const service = () => new DocumentRestService({} as LobeChatDatabase, 'user-1');

describe('DocumentRestService', () => {
  beforeEach(() => {
    findById.mockReset();
    vi.mocked(updateDocumentFromInput).mockReset();
    vi.mocked(getDocumentForViewer).mockReset();
  });

  it('answers 404 for an update to a document that no longer exists, without writing', async () => {
    findById.mockResolvedValue(undefined);

    await expect(service().updateDocument('doc-gone', { title: 'x' })).rejects.toMatchObject({
      status: 404,
    });
    expect(updateDocumentFromInput).not.toHaveBeenCalled();
  });

  it('answers 404 for a document the caller cannot read', async () => {
    vi.mocked(getDocumentForViewer).mockResolvedValue(undefined);

    await expect(service().getDocument('doc-gone')).rejects.toMatchObject({ status: 404 });
  });

  it('returns the stored Markdown after a full update', async () => {
    findById.mockResolvedValue(storedDocument);
    vi.mocked(getDocumentForViewer).mockResolvedValue(storedDocument as never);

    const document = await service().updateDocument('doc-1', {
      content: 'New body',
      title: 'Weekly sync',
    });

    expect(updateDocumentFromInput).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ content: 'New body', id: 'doc-1', title: 'Weekly sync' }),
    );
    expect(document).toEqual({
      content: 'New body',
      createdAt: '2026-11-19T01:00:00.000Z',
      fileType: 'custom/document',
      id: 'doc-1',
      parentId: 'folder-1',
      slug: null,
      title: 'Weekly sync',
      updatedAt: '2026-11-19T02:00:00.000Z',
    });
  });
});
