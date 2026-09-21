// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { documentRouter } from './document';

const mocks = vi.hoisted(() => ({
  createDocument: vi.fn(),
  findOwnOperationById: vi.fn(),
  getDocumentById: vi.fn(),
  getFileAccessUrl: vi.fn(),
  registerDocument: vi.fn(),
  updateDocument: vi.fn(),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return { findOwnOperationById: mocks.findOwnOperationById };
  }),
}));
vi.mock('@/database/models/work', () => ({
  WorkModel: vi.fn().mockImplementation(function () {
    return { registerDocument: mocks.registerDocument };
  }),
}));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/message', () => ({ MessageModel: vi.fn() }));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(),
  DOCUMENT_TRANSFER_FOREIGN_ROWS: 'foreign',
}));
vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn().mockImplementation(function () {
    return {
      createDocument: mocks.createDocument,
      getDocumentById: mocks.getDocumentById,
      updateDocument: mocks.updateDocument,
    };
  }),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return { getFileAccessUrl: mocks.getFileAccessUrl };
  }),
}));
vi.mock('./_helpers/knowledgeBaseAccess', () => ({
  assertContentsNotInRestrictedKnowledgeBase: vi.fn(),
  getRestrictedKnowledgeBaseIds: vi.fn(),
}));
const createCaller = createCallerFactory(documentRouter);
const caller = async () => createCaller(await createContextInner({ userId: 'user-1' }));

describe('document source URL resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFileAccessUrl.mockReset();
  });

  it('reads a text notebook without treating its origin label as an S3 object', async () => {
    const doc = {
      id: 'doc-1',
      source: 'notebook',
      sourceType: 'api',
      fileId: null,
      content: 'Report',
    };
    mocks.getDocumentById.mockResolvedValue(doc);
    mocks.getFileAccessUrl.mockRejectedValue(new Error('Storage is unavailable'));
    await expect((await caller()).getDocumentById({ id: 'doc-1' })).resolves.toEqual(doc);
    expect(mocks.getFileAccessUrl).not.toHaveBeenCalled();
  });

  it('still resolves a stored file source', async () => {
    mocks.getDocumentById.mockResolvedValue({
      id: 'doc-1',
      source: 'files/report.pdf',
      sourceType: 'file',
      fileId: 'file-1',
    });
    mocks.getFileAccessUrl.mockResolvedValue('https://storage.example/signed.pdf');
    await expect((await caller()).getDocumentById({ id: 'doc-1' })).resolves.toEqual(
      expect.objectContaining({ source: 'https://storage.example/signed.pdf' }),
    );
    expect(mocks.getFileAccessUrl).toHaveBeenCalledWith({
      id: 'doc-1',
      fileId: 'file-1',
      url: 'files/report.pdf',
    });
  });

  it('preserves an absolute web source', async () => {
    const doc = { id: 'doc-1', source: 'https://example.com/report', sourceType: 'web' };
    mocks.getDocumentById.mockResolvedValue(doc);
    await expect((await caller()).getDocumentById({ id: 'doc-1' })).resolves.toEqual(doc);
    expect(mocks.getFileAccessUrl).not.toHaveBeenCalled();
  });
});

/**
 * Regression: documents an agent wrote through `lh doc create` were never
 * registered as Work, so a Goal's deliverables stayed empty even though the
 * run produced its report.
 */
describe('document work provenance', () => {
  const liveChild = {
    agentId: 'agent-1',
    id: 'child',
    parentOperationId: 'root',
    status: 'running',
    topicId: 'topic-1',
  };

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.createDocument.mockResolvedValue({ id: 'doc-1', visibility: 'private' });
    mocks.updateDocument.mockResolvedValue({ id: 'doc-1' });
  });

  it('credits a document written from a live run to the root of that run', async () => {
    mocks.findOwnOperationById
      .mockResolvedValueOnce(liveChild)
      .mockResolvedValueOnce({ id: 'root', parentOperationId: null });

    await (await caller()).createDocument({ content: 'Report', operationId: 'child', title: 'R' });

    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.not.objectContaining({ operationId: expect.anything() }),
    );
    expect(mocks.registerDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        changeType: 'created',
        documentId: 'doc-1',
        rootOperationId: 'root',
        topicId: 'topic-1',
      }),
    );
  });

  it.each([
    { label: 'not owned', operation: null },
    { label: 'already finished', operation: { ...liveChild, status: 'done' } },
  ])(
    'writes the document but credits no run when the operation is $label',
    async ({ operation }) => {
      mocks.findOwnOperationById.mockResolvedValue(operation);

      await expect(
        (await caller()).createDocument({ content: 'Report', operationId: 'child', title: 'R' }),
      ).resolves.toMatchObject({ id: 'doc-1' });
      expect(mocks.registerDocument).not.toHaveBeenCalled();
    },
  );

  it('adds a version when a live run edits the content', async () => {
    mocks.findOwnOperationById.mockResolvedValue({ ...liveChild, parentOperationId: null });

    await (await caller()).updateDocument({ content: 'v2', id: 'doc-1', operationId: 'child' });

    expect(mocks.updateDocument).toHaveBeenCalledWith(
      'doc-1',
      expect.not.objectContaining({ operationId: expect.anything() }),
    );
    expect(mocks.registerDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: 'updated',
        documentId: 'doc-1',
        rootOperationId: 'child',
      }),
    );
  });

  it('does not treat a file-type change as a new deliverable version', async () => {
    await (
      await caller()
    ).updateDocument({
      fileType: 'custom/folder',
      id: 'doc-1',
      operationId: 'child',
    });

    expect(mocks.findOwnOperationById).not.toHaveBeenCalled();
    expect(mocks.registerDocument).not.toHaveBeenCalled();
  });

  it('never fails the write when Work bookkeeping fails', async () => {
    mocks.findOwnOperationById.mockResolvedValue({ ...liveChild, parentOperationId: null });
    mocks.registerDocument.mockRejectedValue(new Error('work table unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      (await caller()).updateDocument({ content: 'v2', id: 'doc-1', operationId: 'child' }),
    ).resolves.toMatchObject({ id: 'doc-1' });
  });
});
