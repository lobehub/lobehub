// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { notebookRouter } from './notebook';

const mocks = vi.hoisted(() => ({
  associate: vi.fn(),
  create: vi.fn(),
  findOwnOperationById: vi.fn(),
  registerDocument: vi.fn(),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn().mockImplementation(function () {
    return { create: mocks.create };
  }),
}));
vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn().mockImplementation(function () {
    return { associate: mocks.associate };
  }),
}));
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
vi.mock('@/server/services/notebook', () => ({ NotebookRuntimeService: vi.fn() }));

const createCaller = createCallerFactory(notebookRouter);
const input = {
  content: 'Measured report',
  description: 'Results',
  title: 'Report',
  topicId: 'topic-1',
};

describe('notebook document work provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.create.mockResolvedValue({ id: 'doc-1' });
  });

  const caller = async () => createCaller(await createContextInner({ userId: 'user-1' }));

  it('registers the actual linked document under the owning root run', async () => {
    mocks.findOwnOperationById
      .mockResolvedValueOnce({
        id: 'child',
        parentOperationId: 'root',
        topicId: 'topic-1',
        agentId: 'agent-1',
      })
      .mockResolvedValueOnce({ id: 'root', parentOperationId: null });
    await (await caller()).createDocument({ ...input, operationId: 'child' });
    expect(mocks.associate).toHaveBeenCalledWith({ documentId: 'doc-1', topicId: 'topic-1' });
    expect(mocks.registerDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        rootOperationId: 'root',
        agentId: 'agent-1',
        topicId: 'topic-1',
        changeType: 'created',
      }),
    );
  });

  it.each([null, { id: 'op', topicId: 'other-topic' }])(
    'rejects inaccessible or mismatched provenance before writing',
    async (operation) => {
      mocks.findOwnOperationById.mockResolvedValue(operation);
      await expect(
        (await caller()).createDocument({ ...input, operationId: 'op' }),
      ).rejects.toThrow(/does not belong/);
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.registerDocument).not.toHaveBeenCalled();
    },
  );

  it('keeps ordinary user-created notebooks free of invented agent provenance', async () => {
    await (await caller()).createDocument(input);
    expect(mocks.create).toHaveBeenCalled();
    expect(mocks.findOwnOperationById).not.toHaveBeenCalled();
    expect(mocks.registerDocument).not.toHaveBeenCalled();
  });

  it('rejects inaccessible ancestry before writing', async () => {
    mocks.findOwnOperationById
      .mockResolvedValueOnce({ id: 'child', topicId: 'topic-1', parentOperationId: 'foreign' })
      .mockResolvedValueOnce(null);
    await expect(
      (await caller()).createDocument({ ...input, operationId: 'child' }),
    ).rejects.toThrow(/ancestry/);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
