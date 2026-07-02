import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';

import { agentDocumentService, resolveAgentDocumentsContext } from './agentDocument';

const { contextDocumentsQueryMock, queryMock } = vi.hoisted(() => ({
  contextDocumentsQueryMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    agentDocument: {
      copyDocument: { mutate: queryMock },
      createDocument: { mutate: queryMock },
      getContextDocuments: { query: contextDocumentsQueryMock },
      getDocuments: { query: queryMock },
      getTemplates: { query: queryMock },
      initializeFromTemplate: { mutate: queryMock },
      listDocuments: { query: queryMock },
      readDocument: { query: queryMock },
      removeDocument: { mutate: queryMock },
      renameDocument: { mutate: queryMock },
      replaceDocumentContent: { mutate: queryMock },
      updateLoadRule: { mutate: queryMock },
    },
  },
}));

describe('AgentDocumentService', () => {
  beforeEach(() => {
    queryMock.mockResolvedValue({ ok: true });
    contextDocumentsQueryMock.mockResolvedValue({ ok: true });
    vi.mocked(mutate).mockClear();
    queryMock.mockClear();
    contextDocumentsQueryMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should revalidate agent documents after createDocument', async () => {
    await agentDocumentService.createDocument({
      agentId: 'agent-1',
      content: 'content',
      title: 'title',
    });

    expect(mutate).toHaveBeenCalledWith(['agent:documents', 'agent-1']);
  });

  it('should revalidate agent documents after removeDocument', async () => {
    await agentDocumentService.removeDocument({
      agentId: 'agent-1',
      documentId: 'page-doc-1',
      id: 'doc-1',
      topicId: 'topic-1',
    });

    expect(mutate).toHaveBeenCalledWith(['agent:documents', 'agent-1']);
    expect(mutate).toHaveBeenCalledWith(['agent:documentsList', 'agent-1']);
    expect(mutate).toHaveBeenCalledWith(['agent:documentEditor', 'agent-1', 'doc-1']);
    expect(mutate).toHaveBeenCalledWith(['page:meta', 'page-doc-1']);
    expect(mutate).toHaveBeenCalledWith(['page:detail', 'page-doc-1']);
    expect(mutate).toHaveBeenCalledWith(['page:list']);
    expect(mutate).toHaveBeenCalledWith(['notebook:documents', 'topic-1']);
  });

  it('should revalidate agent documents after updateLoadRule', async () => {
    await agentDocumentService.updateLoadRule({
      agentId: 'agent-1',
      id: 'doc-1',
      rule: {},
    });

    expect(mutate).toHaveBeenCalledWith(['agent:documents', 'agent-1']);
  });

  it('should fetch target agent documents when cache is missing', async () => {
    contextDocumentsQueryMock.mockResolvedValueOnce([
      {
        content: 'Target agent setup',
        contentCharCount: 'Target agent setup'.length,
        filename: 'setup.md',
        id: 'doc-1',
        loadRules: {},
        policy: null,
        policyLoadFormat: null,
        policyLoadPosition: null,
        templateId: null,
        title: 'Setup',
      },
    ]);

    await expect(
      resolveAgentDocumentsContext({
        agentId: 'target-agent',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        content: 'Target agent setup',
        contentCharCount: 'Target agent setup'.length,
        filename: 'setup.md',
        id: 'doc-1',
        loadPosition: undefined,
        loadRules: {},
        policyId: null,
        policyLoadFormat: undefined,
        title: 'Setup',
      }),
    ]);

    expect(contextDocumentsQueryMock).toHaveBeenCalledWith({ agentId: 'target-agent' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('should reuse cached agent documents without refetching', async () => {
    const cachedDocuments = [
      {
        content: 'cached',
        filename: 'cached.md',
        id: 'cached-doc',
        title: 'Cached',
      },
    ];

    await expect(
      resolveAgentDocumentsContext({
        agentId: 'target-agent',
        cachedDocuments,
      }),
    ).resolves.toBe(cachedDocuments);

    expect(contextDocumentsQueryMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });
});
