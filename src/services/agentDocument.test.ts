import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
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

// Every SWR key / matcher handed to `mutate`, so a test can ask whether a
// replica sync key (or a plain `agent:*` SWR key) was revalidated.
const revalidated = () => vi.mocked(mutate).mock.calls.map((call) => call[0]);
const matchesReplica = (key: unknown[]) =>
  revalidated().some((entry) => typeof entry === 'function' && entry(key));
const agentDocumentListSyncKey = (agentId: string) => [
  'replica:sync',
  'agentDocumentList',
  1,
  cacheScope.get(),
  agentId,
  {},
];
const legacyAgentDocumentKeys = () =>
  revalidated().filter(
    (entry) =>
      Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].startsWith('agent:'),
  );

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

    expect(matchesReplica(agentDocumentListSyncKey('agent-1'))).toBe(true);
    expect(legacyAgentDocumentKeys()).toEqual([]);
  });

  it('should revalidate agent documents after removeDocument', async () => {
    await agentDocumentService.removeDocument({
      agentId: 'agent-1',
      documentId: 'page-doc-1',
      id: 'doc-1',
      topicId: 'topic-1',
    });

    // The agent's document list is a replica keyed by agent: the per-agent sync
    // key refreshes, other agents' entries do not, and no plain `agent:*` SWR
    // key is revalidated any more.
    expect(matchesReplica(agentDocumentListSyncKey('agent-1'))).toBe(true);
    expect(matchesReplica(agentDocumentListSyncKey('other-agent'))).toBe(false);
    expect(legacyAgentDocumentKeys()).toEqual([]);
    // The reader replica of the touched document refreshes too.
    expect(
      matchesReplica([
        'replica:sync',
        'agentDocumentReader',
        1,
        cacheScope.get(),
        'agent-1/page-doc-1',
        { agentId: 'agent-1', documentId: 'page-doc-1' },
      ]),
    ).toBe(true);
    // The page domain is a replica, so its list and by-id copies sync through
    // `replica:sync` keys and refresh through the scoped matcher instead of the
    // removed `page:*` SWR keys.
    const scope = cacheScope.get();
    expect(matchesReplica(['replica:sync', 'pageDetail', 1, scope, 'page-doc-1', {}])).toBe(true);
    // `revalidateReplica` without an entry key covers every entry of the
    // resource…
    expect(matchesReplica(['replica:sync', 'pageList', 1, scope, 'all', {}])).toBe(true);
    expect(matchesReplica(['replica:sync', 'pageList', 1, scope, 'any-entry', {}])).toBe(true);
    // …but only that resource, and only inside the active scope.
    expect(matchesReplica(['replica:sync', 'otherResource', 1, scope, 'all', {}])).toBe(false);
    expect(matchesReplica(['replica:sync', 'pageList', 1, 'other:personal', 'all', {}])).toBe(
      false,
    );
    // The notebook list is a replica too, so `topicId` refreshes its sync key
    // instead of the removed `notebook:documents` SWR entry.
    expect(
      matchesReplica(['replica:sync', 'notebookDocuments', 1, scope, 'topic-1', 'topic-1']),
    ).toBe(true);
  });

  it('should revalidate agent documents after updateLoadRule', async () => {
    await agentDocumentService.updateLoadRule({
      agentId: 'agent-1',
      id: 'doc-1',
      rule: {},
    });

    expect(matchesReplica(agentDocumentListSyncKey('agent-1'))).toBe(true);
    expect(legacyAgentDocumentKeys()).toEqual([]);
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
