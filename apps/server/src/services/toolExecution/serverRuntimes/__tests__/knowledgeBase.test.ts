import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';
import { knowledgeBaseRuntime } from '../knowledgeBase';

const mocks = vi.hoisted(() => ({
  getAgentAssignedKnowledge: vi.fn(),
  getEnabledKnowledgeBaseIdsForTask: vi.fn(),
  semanticSearchForChat: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return { getAgentAssignedKnowledge: mocks.getAgentAssignedKnowledge };
  }),
}));

vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn().mockImplementation(function () {
    return { getEnabledKnowledgeBaseIdsForTask: mocks.getEnabledKnowledgeBaseIdsForTask };
  }),
}));

vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/knowledgeBase', () => ({ KnowledgeBaseModel: vi.fn() }));
vi.mock('@/database/repositories/knowledge', () => ({ KnowledgeRepo: vi.fn() }));
vi.mock('@/server/services/document', () => ({ DocumentService: vi.fn() }));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));

vi.mock('@/server/services/knowledgeBase', () => ({
  KnowledgeBaseSearchService: vi.fn().mockImplementation(function () {
    return { semanticSearchForChat: mocks.semanticSearchForChat };
  }),
}));

const createRuntime = (context: Partial<ToolExecutionContext> = {}) =>
  knowledgeBaseRuntime.factory({
    agentId: 'agt_research',
    serverDB: {} as LobeChatDatabase,
    toolManifestMap: {},
    userId: 'user_alice',
    ...context,
  } as ToolExecutionContext);

describe('knowledgeBaseRuntime searchKnowledgeBase scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEnabledKnowledgeBaseIdsForTask.mockResolvedValue([]);
  });

  it('reports an empty scope instead of "no relevant files" when the agent has no attached knowledge base', async () => {
    // The KB the agent just created exists, but is not attached to the agent.
    mocks.getAgentAssignedKnowledge.mockResolvedValue({ files: [], knowledgeBases: [] });

    const result = await createRuntime().searchKnowledgeBase({ query: 'launch checklist' });

    expect(mocks.semanticSearchForChat).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.content).toContain('No enabled knowledge base is in this agent');
    expect(result.content).not.toContain('No relevant files found');
  });

  it('searches the attached knowledge bases and keeps the no-match message when nothing matches', async () => {
    mocks.getAgentAssignedKnowledge.mockResolvedValue({
      files: [],
      knowledgeBases: [
        { enabled: true, id: 'kb_product' },
        { enabled: false, id: 'kb_archived' },
      ],
    });
    mocks.semanticSearchForChat.mockResolvedValue({
      chunks: [],
      documents: [],
      fileResults: [],
      totalResults: 0,
    });

    const result = await createRuntime().searchKnowledgeBase({ query: 'launch checklist' });

    expect(mocks.semanticSearchForChat).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeIds: ['kb_product'], query: 'launch checklist' }),
    );
    expect(result.content).toContain('No relevant files found');
  });
});
