import { type UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { agentDocumentService } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';

import { contextEngineering } from './contextEngineering';
import { createBrowserContextFactProviders } from './contextFactProviders';

vi.hoisted(() => {
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
});

// Mock VARIABLE_GENERATORS
vi.mock('@/helpers/parserPlaceholder', () => ({
  HOST_VARIABLE_GENERATORS: {
    username: () => 'TestUser',
    random: () => '12345',
  },
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    getDocuments: vi.fn(),
    listRevokedDocumentReads: vi.fn(async () => ({ agentDocumentReadIds: [], documentIds: [] })),
  },
}));

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_LIMIT: 10,
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    queryAgents: vi.fn(),
  },
}));

// 默认设置运行环境为 browser/client
const runtimeFlags = vi.hoisted(() => ({
  isServerMode: false,
}));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    get isServerMode() {
      return runtimeFlags.isServerMode;
    },
    isDesktop: false,
    isDeprecatedEdition: false,
  };
});

beforeEach(() => {
  vi.mocked(agentService.queryAgents).mockResolvedValue([]);
  // Temporal placeholders render in the user's timezone; pin it so the
  // expectations below do not depend on the machine running the suite.
  useUserStore.setState({ settings: { general: { timezone: 'UTC' } } } as any);
  useAgentStore.setState({
    activeAgentId: undefined,
    agentDocumentsMap: {},
    agentMap: {},
    availableAgents: undefined,
  } as any);
  useChatStore.setState({ activeAgentId: undefined, activeGroupId: undefined } as any);
});

afterEach(() => {
  runtimeFlags.isServerMode = false;
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('contextEngineering — revoked document reads', () => {
  it('should withhold an earlier read of a document deleted since', async () => {
    const rule = 'STANDING RULE: start every reply with RULE-ACTIVE.';
    const history = [
      { content: 'read the rules', id: 'u1', role: 'user' },
      {
        content: '',
        id: 'a1',
        role: 'assistant',
        tools: [
          {
            apiName: 'readKnowledge',
            arguments: JSON.stringify({ fileIds: ['docs_rule'] }),
            id: 'call_read',
            identifier: 'lobe-knowledge-base',
            type: 'builtin',
          },
        ],
      },
      {
        content: rule,
        id: 't1',
        plugin: {
          apiName: 'readKnowledge',
          arguments: JSON.stringify({ fileIds: ['docs_rule'] }),
          identifier: 'lobe-knowledge-base',
          type: 'builtin',
        },
        role: 'tool',
        tool_call_id: 'call_read',
      },
      { content: 'translate hello', id: 'u2', role: 'user' },
    ] as unknown as UIChatMessage[];
    vi.mocked(agentDocumentService.listRevokedDocumentReads).mockResolvedValueOnce({
      agentDocumentReadIds: [],
      documentIds: ['docs_rule'],
    });

    const output = await contextEngineering({
      agentId: 'agent-1',
      messages: history,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(agentDocumentService.listRevokedDocumentReads).toHaveBeenCalledWith({
      agentId: 'agent-1',
      documentIds: ['docs_rule'],
    });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain('RULE-ACTIVE');
    expect(serialized).toContain('revoked_document_content');
  });
});

describe('createBrowserContextFactProviders — findRevokedDocumentReads', () => {
  it('splits a large lookup into endpoint-sized batches and merges the answers', async () => {
    const ids = Array.from({ length: 1201 }, (_, i) => `docs_${String(i).padStart(4, '0')}`);
    vi.mocked(agentDocumentService.listRevokedDocumentReads).mockImplementation(
      async ({ documentIds }) => ({
        agentDocumentReadIds: [],
        documentIds: documentIds.filter((id) => id.endsWith('0')),
      }),
    );

    const found = await createBrowserContextFactProviders().findRevokedDocumentReads!(
      'agent-1',
      ids,
    );

    const calls = vi.mocked(agentDocumentService.listRevokedDocumentReads).mock.calls;
    expect(calls.map(([params]) => params.documentIds.length)).toEqual([500, 500, 201]);
    expect(found?.documentIds).toHaveLength(121);
  });
});
