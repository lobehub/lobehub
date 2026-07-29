// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AgentDocumentModels from '@/database/models/agentDocuments';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';
import { AgentDocumentsService } from '@/server/services/agentDocuments';

import { agentDocumentRouter } from '../agentDocument';

const mocks = vi.hoisted(() => ({
  associate: vi.fn(),
  createTopic: vi.fn(),
  findByAgentAndDocumentTrigger: vi.fn(),
  findRowByDocumentId: vi.fn(),
  getServerDB: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mocks.getServerDB,
}));

vi.mock('@/database/models/agentDocuments', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentDocumentModels>();

  return {
    ...actual,
    AgentDocumentModel: vi.fn(),
  };
});

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: mocks.createTopic,
    findByAgentAndDocumentTrigger: mocks.findByAgentAndDocumentTrigger,
  })),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn().mockImplementation(() => ({
    associate: mocks.associate,
  })),
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn(),
}));

vi.mock('@/server/services/agentDocumentVfs', () => ({
  AgentDocumentVfsService: vi.fn(),
}));

vi.mock('@/server/services/agentDocuments/toolOutcome', () => ({
  emitAgentDocumentToolOutcomeSafely: vi.fn(),
}));

const createCaller = createCallerFactory(agentDocumentRouter);

describe('agentDocumentRouter.getOrCreateChatTopic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDB.mockResolvedValue({ kind: 'server-db' });

    vi.mocked(AgentDocumentsService).mockImplementation(
      () =>
        ({ findRowByDocumentId: mocks.findRowByDocumentId }) as unknown as AgentDocumentsService,
    );
  });

  it('returns the existing topic when a doc-anchored row is already linked', async () => {
    mocks.findByAgentAndDocumentTrigger.mockResolvedValue({ id: 'topic-existing' });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.getOrCreateChatTopic({
      agentId: 'agent-1',
      documentId: 'docs_abc',
    });

    expect(result).toEqual({ topicId: 'topic-existing' });
    expect(mocks.findByAgentAndDocumentTrigger).toHaveBeenCalledWith({
      agentId: 'agent-1',
      documentId: 'docs_abc',
      trigger: 'document',
    });
    expect(mocks.createTopic).not.toHaveBeenCalled();
    expect(mocks.associate).not.toHaveBeenCalled();
  });

  it('creates a new doc-anchored topic and associates it when none exists', async () => {
    mocks.findByAgentAndDocumentTrigger.mockResolvedValue(undefined);
    mocks.findRowByDocumentId.mockResolvedValue({
      filename: 'spec.md',
      id: 'agent-document-1',
      title: 'Spec',
    });
    mocks.createTopic.mockResolvedValue({ id: 'topic-new' });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.getOrCreateChatTopic({
      agentId: 'agent-1',
      documentId: 'docs_abc',
    });

    expect(result).toEqual({ topicId: 'topic-new' });
    expect(mocks.createTopic).toHaveBeenCalledWith({
      agentId: 'agent-1',
      title: 'Spec',
      trigger: 'document',
    });
    expect(mocks.associate).toHaveBeenCalledWith({
      documentId: 'docs_abc',
      topicId: 'topic-new',
    });
  });

  it('falls back to the filename when the document has no title', async () => {
    mocks.findByAgentAndDocumentTrigger.mockResolvedValue(undefined);
    mocks.findRowByDocumentId.mockResolvedValue({
      filename: 'fallback.md',
      id: 'agent-document-1',
      title: undefined,
    });
    mocks.createTopic.mockResolvedValue({ id: 'topic-new' });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    await caller.getOrCreateChatTopic({ agentId: 'agent-1', documentId: 'docs_abc' });

    expect(mocks.createTopic).toHaveBeenCalledWith({
      agentId: 'agent-1',
      title: 'fallback.md',
      trigger: 'document',
    });
  });

  it('throws NOT_FOUND when the document is missing or not owned by the agent', async () => {
    mocks.findByAgentAndDocumentTrigger.mockResolvedValue(undefined);
    mocks.findRowByDocumentId.mockResolvedValue(undefined);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    await expect(
      caller.getOrCreateChatTopic({ agentId: 'agent-1', documentId: 'docs_missing' }),
    ).rejects.toThrow(/Document not found/);
    expect(mocks.createTopic).not.toHaveBeenCalled();
    expect(mocks.associate).not.toHaveBeenCalled();
  });
});
