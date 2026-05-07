import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { AgentDocumentsService } from '@/server/services/agentDocuments';

import { agentDocumentsRuntime } from '../agentDocuments';

const agentSignalProcedureMocks = vi.hoisted(() => ({
  emitToolOutcomeSafely: vi.fn(),
  resolveToolOutcomeScope: vi.fn(() => ({
    scope: { agentId: 'agent-1', userId: 'user-1' },
    scopeKey: 'agent:agent-1:user:user-1',
  })),
}));

vi.mock('@/server/services/agentDocuments');
vi.mock('@/database/models/task');
vi.mock('@/server/services/agentSignal/procedure', () => agentSignalProcedureMocks);

describe('agentDocumentsRuntime', () => {
  it('should have correct identifier', () => {
    expect(agentDocumentsRuntime.identifier).toBe('lobe-agent-documents');
  });

  it('should throw if userId is missing', () => {
    expect(() =>
      agentDocumentsRuntime.factory({ serverDB: {} as any, toolManifestMap: {} }),
    ).toThrow('userId and serverDB are required for Agent Documents execution');
  });

  it('should throw if serverDB is missing', () => {
    expect(() => agentDocumentsRuntime.factory({ toolManifestMap: {}, userId: 'user-1' })).toThrow(
      'userId and serverDB are required for Agent Documents execution',
    );
  });
});

describe('agentDocumentsRuntime auto-pin to task', () => {
  const newDoc = {
    documentId: 'documents-row-id',
    filename: 'daily-brief',
    id: 'agent-doc-assoc-id',
    title: 'Daily Brief',
  };

  let serviceImpl: {
    copyDocumentById: ReturnType<typeof vi.fn>;
    createDocument: ReturnType<typeof vi.fn>;
    createForTopic: ReturnType<typeof vi.fn>;
    getDocumentSnapshotById: ReturnType<typeof vi.fn>;
    renameDocumentById: ReturnType<typeof vi.fn>;
  };
  let pinDocument: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    agentSignalProcedureMocks.emitToolOutcomeSafely.mockClear();
    agentSignalProcedureMocks.resolveToolOutcomeScope.mockClear();
    serviceImpl = {
      copyDocumentById: vi.fn().mockResolvedValue(newDoc),
      createDocument: vi.fn().mockResolvedValue(newDoc),
      createForTopic: vi.fn().mockResolvedValue(newDoc),
      getDocumentSnapshotById: vi.fn().mockResolvedValue(newDoc),
      renameDocumentById: vi.fn().mockResolvedValue(newDoc),
    };
    pinDocument = vi.fn().mockResolvedValue(undefined);

    vi.mocked(AgentDocumentsService).mockImplementation(() => serviceImpl as any);
    vi.mocked(TaskModel).mockImplementation(() => ({ pinDocument }) as any);
  });

  const buildContext = (taskId?: string) => ({
    serverDB: {} as never,
    taskId,
    toolManifestMap: {},
    userId: 'user-1',
  });

  it('pins newly created document when taskId is in context', async () => {
    const runtime = agentDocumentsRuntime.factory(buildContext('task-1'));

    await runtime.createDocument({ content: 'body', title: 'Daily Brief' }, { agentId: 'agent-1' });

    expect(pinDocument).toHaveBeenCalledWith('task-1', 'documents-row-id', 'agent');
  });

  it('emits create outcomes with the agent document binding id', async () => {
    const runtime = agentDocumentsRuntime.factory(buildContext('task-1'));

    await runtime.createDocument({ content: 'body', title: 'Daily Brief' }, { agentId: 'agent-1' });

    expect(agentSignalProcedureMocks.emitToolOutcomeSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'createDocument',
        relatedObjects: [
          {
            objectId: 'agent-doc-assoc-id',
            objectType: 'agent-document',
            relation: 'created',
          },
        ],
      }),
    );
  });

  it('emits copy outcomes with the agent document binding id', async () => {
    const runtime = agentDocumentsRuntime.factory(buildContext('task-1'));

    await runtime.copyDocument({ id: 'source-agent-doc-id' }, { agentId: 'agent-1' });

    expect(agentSignalProcedureMocks.emitToolOutcomeSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'copyDocument',
        relatedObjects: [
          {
            objectId: 'agent-doc-assoc-id',
            objectType: 'agent-document',
            relation: 'created',
          },
        ],
      }),
    );
  });

  it('emits update outcomes with the input agent document binding id', async () => {
    serviceImpl.createDocument.mockClear();
    const runtime = agentDocumentsRuntime.factory(buildContext('task-1'));

    await runtime.renameDocument(
      { id: 'agent-doc-assoc-id', newTitle: 'Renamed' },
      { agentId: 'agent-1' },
    );

    expect(agentSignalProcedureMocks.emitToolOutcomeSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'renameDocument',
        relatedObjects: [
          {
            objectId: 'agent-doc-assoc-id',
            objectType: 'agent-document',
            relation: 'updated',
          },
        ],
      }),
    );
  });

  it('skips pin when no taskId is provided', async () => {
    const runtime = agentDocumentsRuntime.factory(buildContext());

    await runtime.createDocument({ content: 'body', title: 'Daily Brief' }, { agentId: 'agent-1' });

    expect(pinDocument).not.toHaveBeenCalled();
  });

  it('pins documents created via createTopicDocument', async () => {
    const runtime = agentDocumentsRuntime.factory(buildContext('task-1'));

    await runtime.createDocument(
      { content: 'body', target: 'currentTopic', title: 'Topic Note' },
      { agentId: 'agent-1', topicId: 'topic-1' },
    );

    expect(pinDocument).toHaveBeenCalledWith('task-1', 'documents-row-id', 'agent');
  });

  it('pins documents produced by copyDocument', async () => {
    const runtime = agentDocumentsRuntime.factory(buildContext('task-1'));

    await runtime.copyDocument(
      { id: 'agent-doc-assoc-id', newTitle: 'Copy' },
      { agentId: 'agent-1' },
    );

    expect(pinDocument).toHaveBeenCalledWith('task-1', 'documents-row-id', 'agent');
  });

  it('does not pin when service returns undefined (e.g. copy of missing doc)', async () => {
    serviceImpl.copyDocumentById.mockResolvedValue(undefined);
    const runtime = agentDocumentsRuntime.factory(buildContext('task-1'));

    await runtime.copyDocument({ id: 'missing' }, { agentId: 'agent-1' });

    expect(pinDocument).not.toHaveBeenCalled();
  });
});

describe('AgentDocumentsExecutionRuntime.createDocument', () => {
  const makeStub = () => ({
    copyDocument: vi.fn(),
    createDocument: vi.fn(),
    createTopicDocument: vi.fn(),
    listDocuments: vi.fn(),
    listTopicDocuments: vi.fn(),
    modifyNodes: vi.fn(),
    readDocument: vi.fn(),
    removeDocument: vi.fn(),
    renameDocument: vi.fn(),
    replaceDocumentContent: vi.fn(),
    updateLoadRule: vi.fn(),
  });

  it('returns both agentDocuments.id and documents.id in create state', async () => {
    const stub = makeStub();
    stub.createDocument.mockResolvedValue({
      documentId: 'documents-row-id',
      filename: 'daily-brief',
      id: 'agent-doc-assoc-id',
      title: 'Daily Brief',
    });

    const runtime = new AgentDocumentsExecutionRuntime(stub);
    const result = await runtime.createDocument(
      { content: 'body', title: 'Daily Brief' },
      { agentId: 'agent-1' },
    );

    expect(result.success).toBe(true);
    expect(result.state).toEqual({
      agentDocumentId: 'agent-doc-assoc-id',
      documentId: 'documents-row-id',
    });
  });

  it('refuses to run without agentId', async () => {
    const stub = makeStub();
    const runtime = new AgentDocumentsExecutionRuntime(stub);

    const result = await runtime.createDocument({ content: 'body', title: 'T' }, {});

    expect(result.success).toBe(false);
    expect(stub.createDocument).not.toHaveBeenCalled();
  });

  it('creates a document in the current topic when target is currentTopic', async () => {
    const stub = makeStub();
    stub.createTopicDocument.mockResolvedValue({
      documentId: 'documents-row-id',
      filename: 'topic-note',
      id: 'agent-doc-assoc-id',
      title: 'Topic Note',
    });

    const runtime = new AgentDocumentsExecutionRuntime(stub);
    const result = await runtime.createDocument(
      { content: 'body', target: 'currentTopic', title: 'Topic Note' },
      { agentId: 'agent-1', topicId: 'topic-1' },
    );

    expect(result.success).toBe(true);
    expect(result.state).toEqual({
      agentDocumentId: 'agent-doc-assoc-id',
      documentId: 'documents-row-id',
    });
    expect(stub.createTopicDocument).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'body',
      target: 'currentTopic',
      title: 'Topic Note',
      topicId: 'topic-1',
    });
    expect(stub.createDocument).not.toHaveBeenCalled();
  });

  it('refuses current topic creation without topicId', async () => {
    const stub = makeStub();
    const runtime = new AgentDocumentsExecutionRuntime(stub);

    const result = await runtime.createDocument(
      { content: 'body', target: 'currentTopic', title: 'Topic Note' },
      { agentId: 'agent-1' },
    );

    expect(result).toMatchObject({
      content: 'Cannot create current topic document without topicId context.',
      success: false,
    });
    expect(stub.createTopicDocument).not.toHaveBeenCalled();
  });

  it('blocks replaceDocumentContent for the current page document', async () => {
    const stub = makeStub();
    stub.readDocument.mockResolvedValue({
      content: 'body',
      documentId: 'documents-row-id',
      id: 'agent-doc-assoc-id',
      title: 'Daily Brief',
    });

    const runtime = new AgentDocumentsExecutionRuntime(stub);
    const result = await runtime.replaceDocumentContent(
      { content: 'updated', id: 'agent-doc-assoc-id' },
      {
        agentId: 'agent-1',
        currentDocumentId: 'documents-row-id',
        scope: 'page',
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'CURRENT_PAGE_DOCUMENT_WRITE_FORBIDDEN',
      kind: 'replan',
    });
    expect(stub.replaceDocumentContent).not.toHaveBeenCalled();
  });

  it('still allows replacing a different agent document in page scope', async () => {
    const stub = makeStub();
    stub.readDocument.mockResolvedValue({
      content: 'body',
      documentId: 'documents-row-id-2',
      id: 'agent-doc-assoc-id-2',
      title: 'Other Doc',
    });
    stub.replaceDocumentContent.mockResolvedValue({
      content: 'updated',
      documentId: 'documents-row-id-2',
      id: 'agent-doc-assoc-id-2',
      title: 'Other Doc',
    });

    const runtime = new AgentDocumentsExecutionRuntime(stub);
    const result = await runtime.replaceDocumentContent(
      { content: 'updated', id: 'agent-doc-assoc-id-2' },
      {
        agentId: 'agent-1',
        currentDocumentId: 'documents-row-id',
        scope: 'page',
      },
    );

    expect(result.success).toBe(true);
    expect(stub.replaceDocumentContent).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'updated',
      id: 'agent-doc-assoc-id-2',
    });
  });
});

describe('AgentDocumentsExecutionRuntime.listDocuments', () => {
  const makeStub = () => ({
    copyDocument: vi.fn(),
    createDocument: vi.fn(),
    createTopicDocument: vi.fn(),
    listDocuments: vi.fn(),
    listTopicDocuments: vi.fn(),
    modifyNodes: vi.fn(),
    readDocument: vi.fn(),
    removeDocument: vi.fn(),
    renameDocument: vi.fn(),
    replaceDocumentContent: vi.fn(),
    updateLoadRule: vi.fn(),
  });

  it('lists current topic documents while preserving agent document ids', async () => {
    const stub = makeStub();
    stub.listTopicDocuments.mockResolvedValue([
      {
        documentId: 'documents-row-id',
        filename: 'topic-note',
        id: 'agent-doc-assoc-id',
        title: 'Topic Note',
      },
    ]);

    const runtime = new AgentDocumentsExecutionRuntime(stub);
    const result = await runtime.listDocuments(
      { target: 'currentTopic' },
      { agentId: 'agent-1', topicId: 'topic-1' },
    );

    const documents = [
      {
        documentId: 'documents-row-id',
        filename: 'topic-note',
        id: 'agent-doc-assoc-id',
        title: 'Topic Note',
      },
    ];
    expect(result).toEqual({
      content: JSON.stringify(documents),
      state: { documents },
      success: true,
    });
    expect(stub.listTopicDocuments).toHaveBeenCalledWith({
      agentId: 'agent-1',
      target: 'currentTopic',
      topicId: 'topic-1',
    });
    expect(stub.listDocuments).not.toHaveBeenCalled();
  });
});
