import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';
import { knowledgeBaseRuntime } from '../knowledgeBase';

const mocks = vi.hoisted(() => ({
  createDocument: vi.fn(),
  getAgentAssignedKnowledge: vi.fn(),
  getEnabledKnowledgeBaseIds: vi.fn(),
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
    return {
      getEnabledKnowledgeBaseIds: mocks.getEnabledKnowledgeBaseIds,
      getEnabledKnowledgeBaseIdsForTask: mocks.getEnabledKnowledgeBaseIdsForTask,
    };
  }),
}));

vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/knowledgeBase', () => ({ KnowledgeBaseModel: vi.fn() }));
vi.mock('@/database/repositories/knowledge', () => ({ KnowledgeRepo: vi.fn() }));
vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn().mockImplementation(function () {
    return { createDocument: mocks.createDocument };
  }),
}));
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
    mocks.getEnabledKnowledgeBaseIds.mockResolvedValue([]);
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

  it('searches the project knowledge for an agent talking inside a project', async () => {
    // A project coordinator has no knowledge of its own and no task: before the
    // project scope reached the runtime, its search always came back empty.
    mocks.getAgentAssignedKnowledge.mockResolvedValue({
      files: [],
      knowledgeBases: [{ enabled: true, id: 'kb_agent' }],
    });
    mocks.getEnabledKnowledgeBaseIds.mockResolvedValue(['kb_project', 'kb_agent']);
    mocks.semanticSearchForChat.mockResolvedValue({
      chunks: [],
      documents: [],
      fileResults: [],
      totalResults: 0,
    });

    await createRuntime({ projectId: 'proj_apollo', taskId: 'task_1' }).searchKnowledgeBase({
      query: 'launch checklist',
    });

    expect(mocks.getEnabledKnowledgeBaseIds).toHaveBeenCalledWith('proj_apollo');
    expect(mocks.getEnabledKnowledgeBaseIdsForTask).not.toHaveBeenCalled();
    expect(mocks.semanticSearchForChat).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeIds: ['kb_agent', 'kb_project'] }),
    );
  });
});

describe('knowledgeBaseRuntime createDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDocument.mockResolvedValue({ id: 'docs_1' });
  });

  /**
   * Regression: the document title renders as the page header, so a body that
   * opened with the same `# Title` showed it twice, and the page was stored
   * with an empty `{}` editor state instead of one built from the Markdown.
   */
  it('drops the body heading that repeats the title and stores real editor state', async () => {
    await createRuntime().createDocument({
      content: '# Launch checklist\n\n- ship it\n',
      knowledgeBaseId: 'kb_product',
      title: 'Launch checklist',
    });

    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '- ship it\n',
        editorData: expect.objectContaining({ root: expect.anything() }),
        title: 'Launch checklist',
      }),
    );
  });
});
