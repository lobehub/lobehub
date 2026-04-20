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
    editDocument: vi.fn(),
    listDocuments: vi.fn(),
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
});
