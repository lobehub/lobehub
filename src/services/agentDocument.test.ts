import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';

import {
  agentDocumentService,
  mapAgentDocumentsToContext,
  resolveAgentDocumentsContext,
} from './agentDocument';

const { queryMock } = vi.hoisted(() => ({
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
      editDocument: { mutate: queryMock },
      getDocuments: { query: queryMock },
      getTemplates: { query: queryMock },
      initializeFromTemplate: { mutate: queryMock },
      listDocuments: { query: queryMock },
      readDocument: { query: queryMock },
      readDocumentByFilename: { query: queryMock },
      removeDocument: { mutate: queryMock },
      renameDocument: { mutate: queryMock },
      updateLoadRule: { mutate: queryMock },
      upsertDocumentByFilename: { mutate: queryMock },
    },
  },
}));

describe('AgentDocumentService', () => {
  beforeEach(() => {
    queryMock.mockResolvedValue({ ok: true });
    vi.mocked(mutate).mockClear();
    queryMock.mockClear();
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

    expect(mutate).toHaveBeenCalledWith(['agent-documents', 'agent-1']);
  });

  it('should revalidate agent documents after removeDocument', async () => {
    await agentDocumentService.removeDocument({
      agentId: 'agent-1',
      id: 'doc-1',
    });

    expect(mutate).toHaveBeenCalledWith(['agent-documents', 'agent-1']);
  });

  it('should revalidate agent documents after updateLoadRule', async () => {
    await agentDocumentService.updateLoadRule({
      agentId: 'agent-1',
      id: 'doc-1',
      rule: {},
    });

    expect(mutate).toHaveBeenCalledWith(['agent-documents', 'agent-1']);
  });

  it('should map fetched documents into context format', () => {
    expect(
      mapAgentDocumentsToContext([
        {
          content: 'Target agent setup',
          filename: 'setup.md',
          id: 'doc-1',
          loadRules: [],
          policy: null,
          policyLoadFormat: null,
          policyLoadPosition: null,
          templateId: null,
          title: 'Setup',
        },
      ] as any),
    ).toEqual([
      {
        content: 'Target agent setup',
        filename: 'setup.md',
        id: 'doc-1',
        loadPosition: undefined,
        loadRules: [],
        policyId: null,
        policyLoadFormat: undefined,
        title: 'Setup',
      },
    ]);
  });

  it('should fetch target agent documents when cache is missing', async () => {
    queryMock.mockResolvedValueOnce([
      {
        content: 'Target agent setup',
        filename: 'setup.md',
        id: 'doc-1',
        loadRules: [],
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
      {
        content: 'Target agent setup',
        filename: 'setup.md',
        id: 'doc-1',
        loadPosition: undefined,
        loadRules: [],
        policyId: null,
        policyLoadFormat: undefined,
        title: 'Setup',
      },
    ]);

    expect(queryMock).toHaveBeenCalledWith({ agentId: 'target-agent' });
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

    expect(queryMock).not.toHaveBeenCalled();
  });
});
