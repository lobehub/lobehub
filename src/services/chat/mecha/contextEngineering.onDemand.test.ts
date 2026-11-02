import { type UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';

import { contextEngineering } from './contextEngineering';

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
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_LIMIT: 10,
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    queryAgents: vi.fn(),
  },
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    getDocuments: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(agentService.queryAgents).mockResolvedValue([]);
  useAgentStore.setState({
    activeAgentId: undefined,
    agentMap: {},
    availableAgents: undefined,
  });
});

describe('contextEngineering on-demand contract', () => {
  it('uses the shared messages engine and returns the same metadata as the server', async () => {
    const systemRole = '  Client Agent Prompt\nkeep exactly  ';
    const current = 'client current {{username}} message';
    const result = await contextEngineering({
      contextMode: 'on-demand',
      enableAgentMode: true,
      enableUserMemories: true,
      messages: [
        {
          content: current,
          createdAt: 1,
          id: 'client-u1',
          role: 'user',
          updatedAt: 1,
        } as UIChatMessage,
      ],
      model: 'gpt-4',
      provider: 'openai',
      systemRole,
    });

    expect(result.messages[0].content).toContain(systemRole);
    expect(result.messages[0].content).not.toContain('Current date:');
    expect(result.messages[1].content).toBe(current);
    expect(result.onDemandContext).toMatchObject({
      contextMode: 'on-demand',
      rawSystemRoleHash: expect.stringMatching(/^md5:/),
      stablePrefixHash: expect.stringMatching(/^md5:/),
    });
  });
});
