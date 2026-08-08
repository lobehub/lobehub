// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AgentDocumentModels from '@/database/models/agentDocuments';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { emitAgentDocumentToolOutcomeSafely } from '@/server/services/agentDocuments/toolOutcome';

import { agentDocumentRouter } from '../agentDocument';

const agentDocumentMocks = vi.hoisted(() => ({
  deleteDocumentWork: vi.fn(),
  emitAgentDocumentToolOutcomeSafely: vi.fn(),
  findTopicById: vi.fn(),
  getServerDB: vi.fn(),
  registerDocument: vi.fn(),
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

vi.mock('@/database/models/work', () => ({
  WorkModel: vi.fn().mockImplementation(() => ({
    deleteDocumentWork: agentDocumentMocks.deleteDocumentWork,
    registerDocument: agentDocumentMocks.registerDocument,
  })),
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
  getDocumentById: ReturnType<typeof vi.fn>;
  removeDocumentById: ReturnType<typeof vi.fn>;
  renameDocumentById: ReturnType<typeof vi.fn>;
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
    agentDocumentMocks.deleteDocumentWork.mockResolvedValue(undefined);
    agentDocumentMocks.getServerDB.mockResolvedValue({ kind: 'server-db' });
    agentDocumentMocks.findTopicById.mockResolvedValue({ title: 'Topic fallback' });
    agentDocumentMocks.registerDocument.mockResolvedValue({ id: 'work-1' });

    serviceImpl = {
      createDocument: vi.fn().mockResolvedValue(createdDocument),
      createForTopic: vi.fn().mockResolvedValue(createdDocument),
      getDocumentById: vi.fn().mockResolvedValue(createdDocument),
      removeDocumentById: vi.fn().mockResolvedValue(true),
      renameDocumentById: vi.fn().mockResolvedValue({ ...createdDocument, title: 'Renamed' }),
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
        threadId: 'thread-1',
        toolCallId: 'tool-call-1',
        toolMessageId: 'tool-message-1',
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
    // Document Work registration moved to the client (legacy) runtime's stash +
    // `call_tool` write-once path, so the lambda no longer registers on create.
    expect(agentDocumentMocks.registerDocument).not.toHaveBeenCalled();
  });

  it('does not emit outcome for normal createDocument', async () => {
    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.createDocument({
      agentId: 'agent-1',
      content: 'body',
      title: 'Daily Brief',
    });

    expect(emitAgentDocumentToolOutcomeSafely).not.toHaveBeenCalled();
    expect(agentDocumentMocks.registerDocument).not.toHaveBeenCalled();
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
        threadId: 'thread-1',
        toolCallId: 'tool-call-1',
        toolMessageId: 'tool-message-1',
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
    // See the createDocument case: registration is client-side now.
    expect(agentDocumentMocks.registerDocument).not.toHaveBeenCalled();
  });

  it('does not register document work on the lambda for attributed renameDocument', async () => {
    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.renameDocument({
      agentId: 'agent-1',
      id: 'agent-document-1',
      newTitle: 'Renamed',
      toolContext: {
        messageId: 'message-1',
        operationId: 'operation-1',
        rootOperationId: 'root-operation-1',
        threadId: 'thread-rename',
        toolCallId: 'tool-call-rename',
        toolMessageId: 'tool-message-rename',
      },
      trigger: 'tool',
    });

    // The client runtime stashes the rename intent and writes the Work version
    // once cost is known; the lambda mutation no longer registers Work.
    expect(agentDocumentMocks.registerDocument).not.toHaveBeenCalled();
  });

  it('deletes document work for attributed removeDocument', async () => {
    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.removeDocument({
      agentId: 'agent-1',
      id: 'agent-document-1',
      toolContext: {
        messageId: 'message-1',
        operationId: 'operation-1',
        toolCallId: 'tool-call-remove',
      },
      trigger: 'tool',
    });

    expect(agentDocumentMocks.deleteDocumentWork).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDocumentId: 'agent-document-1',
        agentId: 'agent-1',
        documentId: 'document-1',
      }),
    );
  });
});
