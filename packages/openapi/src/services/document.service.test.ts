import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import { exportEditorDataSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import {
  createDocumentFromInput,
  updateDocumentFromInput,
} from '@/server/services/document/writeFlow';
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
vi.mock('@/server/services/agentDocuments/headlessEditor', () => ({
  exportEditorDataSnapshot: vi.fn(),
}));
vi.mock('@/server/routers/lambda/_schema/documentHistory', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DOCUMENT_EDITOR_DATA_MAX_LENGTH: 2000,
}));
vi.mock('@/server/services/documentAccess', () => ({ getDocumentForViewer: vi.fn() }));
vi.mock('@/server/services/knowledgeBaseAccess', () => ({
  assertContentsNotInRestrictedKnowledgeBase: vi.fn(),
  getRestrictedKnowledgeBaseIds: vi.fn(async () => []),
}));

const editorData = {
  root: {
    children: [
      {
        children: [{ text: 'New body', type: 'text', version: 1 }],
        type: 'paragraph',
        version: 1,
      },
    ],
    type: 'root',
    version: 1,
  },
};

const storedDocument = {
  content: 'New body',
  createdAt: new Date('2026-11-19T01:00:00Z'),
  editorData,
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
    vi.mocked(createDocumentFromInput).mockReset();
    vi.mocked(updateDocumentFromInput).mockReset();
    vi.mocked(getDocumentForViewer).mockReset();
    vi.mocked(exportEditorDataSnapshot).mockReset();
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

  it('returns the stored Markdown and editor data after a full update', async () => {
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
      editorData,
      fileType: 'custom/document',
      id: 'doc-1',
      parentId: 'folder-1',
      slug: null,
      title: 'Weekly sync',
      updatedAt: '2026-11-19T02:00:00.000Z',
    });
  });

  it('returns null editor data for a page without Lexical state', async () => {
    vi.mocked(getDocumentForViewer).mockResolvedValue({
      ...storedDocument,
      editorData: { content: 'legacy', type: 'doc' },
    } as never);

    const document = await service().getDocument('doc-1');

    expect(document.editorData).toBeNull();
  });

  describe('editorData writes', () => {
    it('stores editor data sent alone with the Markdown the editor exports from it', async () => {
      findById.mockResolvedValue(storedDocument);
      vi.mocked(getDocumentForViewer).mockResolvedValue(storedDocument as never);
      vi.mocked(exportEditorDataSnapshot).mockResolvedValue({
        content: 'New body\n',
        editorData,
      });

      await service().updateDocument('doc-1', { editorData });

      expect(exportEditorDataSnapshot).toHaveBeenCalledWith({ editorData });
      expect(updateDocumentFromInput).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: 'New body\n',
          editorData: JSON.stringify(editorData),
          id: 'doc-1',
        }),
      );
    });

    it('keeps the Markdown sent with editor data instead of exporting it', async () => {
      findById.mockResolvedValue(storedDocument);
      vi.mocked(getDocumentForViewer).mockResolvedValue(storedDocument as never);

      await service().updateDocument('doc-1', { content: 'Client body', editorData });

      expect(exportEditorDataSnapshot).not.toHaveBeenCalled();
      expect(updateDocumentFromInput).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: 'Client body',
          editorData: JSON.stringify(editorData),
        }),
      );
    });

    it('rejects editor data for an HTML page without writing', async () => {
      findById.mockResolvedValue({ ...storedDocument, fileType: 'custom/html' });

      await expect(service().updateDocument('doc-1', { editorData })).rejects.toMatchObject({
        code: 'bad_request',
        status: 400,
      });
      expect(updateDocumentFromInput).not.toHaveBeenCalled();
    });

    it('rejects editor data longer than the serialized limit without writing', async () => {
      findById.mockResolvedValue(storedDocument);
      const longText = 'x'.repeat(2000);
      const oversized = {
        root: { ...editorData.root, children: [{ text: longText, type: 'text', version: 1 }] },
      };

      await expect(
        service().updateDocument('doc-1', { editorData: oversized }),
      ).rejects.toMatchObject({
        code: 'validation_error',
        details: [expect.objectContaining({ path: 'json.editorData' })],
        status: 400,
      });
      expect(updateDocumentFromInput).not.toHaveBeenCalled();
    });

    it('creates a page from editor data sent alone', async () => {
      vi.mocked(exportEditorDataSnapshot).mockResolvedValue({
        content: 'New body\n',
        editorData,
      });
      vi.mocked(createDocumentFromInput).mockResolvedValue(storedDocument as never);

      await service().createDocument({ editorData, title: 'Weekly sync' });

      expect(createDocumentFromInput).toHaveBeenCalledWith(expect.anything(), {
        content: 'New body\n',
        editorData: JSON.stringify(editorData),
        title: 'Weekly sync',
      });
    });

    it('rejects editor data for a new folder', async () => {
      await expect(
        service().createDocument({ editorData, fileType: 'custom/folder', title: 'Minutes' }),
      ).rejects.toMatchObject({ status: 400 });
      expect(createDocumentFromInput).not.toHaveBeenCalled();
    });
  });

  describe('ifUpdatedAt', () => {
    it('answers 409 with the stored updatedAt when the page changed since, without writing', async () => {
      findById.mockResolvedValue(storedDocument);

      await expect(
        service().updateDocument('doc-1', {
          content: 'Stale body',
          ifUpdatedAt: '2026-11-19T01:30:00.000Z',
        }),
      ).rejects.toMatchObject({
        code: 'conflict',
        details: [{ message: '2026-11-19T02:00:00.000Z', path: 'json.ifUpdatedAt' }],
        status: 409,
      });
      expect(updateDocumentFromInput).not.toHaveBeenCalled();
    });

    it('writes with the version predicate when the page is unchanged', async () => {
      findById.mockResolvedValue(storedDocument);
      vi.mocked(getDocumentForViewer).mockResolvedValue(storedDocument as never);

      await service().updateDocument('doc-1', {
        content: 'New body',
        ifUpdatedAt: '2026-11-19T02:00:00.000Z',
      });

      expect(updateDocumentFromInput).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: 'New body',
          expectedUpdatedAt: new Date('2026-11-19T02:00:00.000Z'),
        }),
      );
      expect(vi.mocked(updateDocumentFromInput).mock.calls[0][1]).not.toHaveProperty('ifUpdatedAt');
    });

    it('answers 409 when another save lands between the check and the write', async () => {
      findById
        .mockResolvedValueOnce(storedDocument)
        .mockResolvedValueOnce({ ...storedDocument, updatedAt: new Date('2026-11-19T03:00:00Z') });
      vi.mocked(updateDocumentFromInput).mockRejectedValue(
        new TRPCError({
          cause: { data: { code: 'DocumentVersionMismatch' } } as never,
          code: 'CONFLICT',
          message: 'Document has been updated by another session',
        }),
      );

      await expect(
        service().updateDocument('doc-1', {
          content: 'New body',
          ifUpdatedAt: '2026-11-19T02:00:00.000Z',
        }),
      ).rejects.toMatchObject({
        code: 'conflict',
        details: [{ message: '2026-11-19T03:00:00.000Z', path: 'json.ifUpdatedAt' }],
        status: 409,
      });
    });
  });
});
