// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AgentDocumentModels from '@/database/models/agentDocuments';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { emitAgentDocumentToolOutcomeSafely } from '@/server/services/agentDocuments/toolOutcome';

import { agentDocumentRouter } from '../agentDocument';

const agentDocumentMocks = vi.hoisted(() => ({
  emitAgentDocumentToolOutcomeSafely: vi.fn(),
  findTopicById: vi.fn(),
  getServerDB: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: agentDocumentMocks.getServerDB,
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
    findById: agentDocumentMocks.findTopicById,
  })),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(),
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn(),
}));

vi.mock('@/server/services/agentDocumentVfs', () => ({
  AgentDocumentVfsService: vi.fn(),
}));

vi.mock('@/server/services/agentDocuments/toolOutcome', () => ({
  emitAgentDocumentToolOutcomeSafely: agentDocumentMocks.emitAgentDocumentToolOutcomeSafely,
}));

const createCaller = createCallerFactory(agentDocumentRouter);

interface MockAgentDocumentsService {
  createDocument: ReturnType<typeof vi.fn>;
  createForTopic: ReturnType<typeof vi.fn>;
}

describe('agentDocumentRouter tool outcomes', () => {
  const createdDocument = {
    documentId: 'document-1',
    filename: 'daily-brief',
    id: 'agent-document-1',
    title: 'Daily Brief',
  };

  let serviceImpl: MockAgentDocumentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    agentDocumentMocks.getServerDB.mockResolvedValue({ kind: 'server-db' });
    agentDocumentMocks.findTopicById.mockResolvedValue({ title: 'Topic fallback' });

    serviceImpl = {
      createDocument: vi.fn().mockResolvedValue(createdDocument),
      createForTopic: vi.fn().mockResolvedValue(createdDocument),
    };
    vi.mocked(AgentDocumentsService).mockImplementation(
      () => serviceImpl as unknown as AgentDocumentsService,
    );
  });

  it('emits success outcome for attributed createDocument', async () => {
    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.createDocument({
      agentId: 'agent-1',
      content: 'body',
      hintIsSkill: true,
      title: 'Daily Brief',
      toolContext: {
        messageId: 'message-1',
        operationId: 'operation-1',
        taskId: 'task-1',
        toolCallId: 'tool-call-1',
        topicId: 'topic-1',
      },
      trigger: 'tool',
    });

    expect(emitAgentDocumentToolOutcomeSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDocumentId: 'agent-document-1',
        agentId: 'agent-1',
        apiName: 'createDocument',
        hintIsSkill: true,
        messageId: 'message-1',
        operationId: 'operation-1',
        relation: 'created',
        status: 'succeeded',
        taskId: 'task-1',
        toolAction: 'create',
        toolCallId: 'tool-call-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    );
  });

  it('does not emit outcome for normal createDocument', async () => {
    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.createDocument({
      agentId: 'agent-1',
      content: 'body',
      title: 'Daily Brief',
    });

    expect(emitAgentDocumentToolOutcomeSafely).not.toHaveBeenCalled();
  });

  it('rejects tool trigger without toolContext', async () => {
    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.createDocument({
        agentId: 'agent-1',
        content: 'body',
        title: 'Daily Brief',
        trigger: 'tool',
      }),
    ).rejects.toThrow('toolContext is required when trigger is tool');
  });

  it('emits success outcome for attributed createForTopic', async () => {
    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.createForTopic({
      agentId: 'agent-1',
      content: 'body',
      title: 'Topic Brief',
      topicId: 'topic-1',
      toolContext: {
        messageId: 'message-1',
        operationId: 'operation-1',
        taskId: null,
        toolCallId: 'tool-call-1',
      },
      trigger: 'tool',
    });

    expect(emitAgentDocumentToolOutcomeSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDocumentId: 'agent-document-1',
        agentId: 'agent-1',
        apiName: 'createForTopic',
        messageId: 'message-1',
        operationId: 'operation-1',
        relation: 'created',
        status: 'succeeded',
        taskId: null,
        toolAction: 'create',
        toolCallId: 'tool-call-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    );
  });
});
