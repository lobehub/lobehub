import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';
import { describe, expect, it, vi } from 'vitest';

import { agentDocumentsRuntime } from '../agentDocuments';

vi.mock('@/server/services/agentDocuments');

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

describe('AgentDocumentsExecutionRuntime.createDocument', () => {
  const makeStub = () => ({
    copyDocument: vi.fn(),
    createDocument: vi.fn(),
    createTopicDocument: vi.fn(),
    editDocument: vi.fn(),
    listDocuments: vi.fn(),
    listTopicDocuments: vi.fn(),
    modifyNodes: vi.fn(),
    readDocument: vi.fn(),
    readDocumentByFilename: vi.fn(),
    removeDocument: vi.fn(),
    renameDocument: vi.fn(),
    updateLoadRule: vi.fn(),
    upsertDocumentByFilename: vi.fn(),
  });

  it('returns documents.id (not agentDocuments.id) for state.documentId', async () => {
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
    expect(result.state).toEqual({ documentId: 'documents-row-id' });
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
    expect(result.state).toEqual({ documentId: 'documents-row-id' });
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

  it('blocks editDocument for the current page document', async () => {
    const stub = makeStub();
    stub.readDocument.mockResolvedValue({
      content: 'body',
      documentId: 'documents-row-id',
      id: 'agent-doc-assoc-id',
      title: 'Daily Brief',
    });

    const runtime = new AgentDocumentsExecutionRuntime(stub);
    const result = await runtime.editDocument(
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
    expect(stub.editDocument).not.toHaveBeenCalled();
  });

  it('blocks upsertDocumentByFilename when the filename resolves to the current page document', async () => {
    const stub = makeStub();
    stub.listDocuments.mockResolvedValue([
      {
        documentId: 'documents-row-id',
        filename: 'current-doc.md',
        id: 'agent-doc-assoc-id',
        title: 'Current Doc',
      },
    ]);

    const runtime = new AgentDocumentsExecutionRuntime(stub);
    const result = await runtime.upsertDocumentByFilename(
      { content: 'updated', filename: 'current-doc.md' },
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
    expect(stub.upsertDocumentByFilename).not.toHaveBeenCalled();
  });

  it('still allows editing a different agent document in page scope', async () => {
    const stub = makeStub();
    stub.readDocument.mockResolvedValue({
      content: 'body',
      documentId: 'documents-row-id-2',
      id: 'agent-doc-assoc-id-2',
      title: 'Other Doc',
    });
    stub.editDocument.mockResolvedValue({
      content: 'updated',
      documentId: 'documents-row-id-2',
      id: 'agent-doc-assoc-id-2',
      title: 'Other Doc',
    });

    const runtime = new AgentDocumentsExecutionRuntime(stub);
    const result = await runtime.editDocument(
      { content: 'updated', id: 'agent-doc-assoc-id-2' },
      {
        agentId: 'agent-1',
        currentDocumentId: 'documents-row-id',
        scope: 'page',
      },
    );

    expect(result.success).toBe(true);
    expect(stub.editDocument).toHaveBeenCalledWith({
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
    editDocument: vi.fn(),
    listDocuments: vi.fn(),
    listTopicDocuments: vi.fn(),
    modifyNodes: vi.fn(),
    readDocument: vi.fn(),
    readDocumentByFilename: vi.fn(),
    removeDocument: vi.fn(),
    renameDocument: vi.fn(),
    updateLoadRule: vi.fn(),
    upsertDocumentByFilename: vi.fn(),
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
