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

describe('knowledgeBaseRuntime deleteFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupFileModel = (fileModelMock: any, file?: Record<string, any>) => {
    fileModelMock.findById = vi.fn().mockResolvedValue(file ?? null);
    fileModelMock.delete = vi.fn().mockResolvedValue(file ? { url: 'https://r2.example/f.png' } : null);
  };

  it('deletes via FileModel with router semantics and removes the stored object', async () => {
    const { FileModel } = await import('@/database/models/file');
    const { FileService } = await import('@/server/services/file');
    const fileModelMock: any = new (FileModel as any)();
    const fileServiceMock: any = new (FileService as any)();
    setupFileModel(fileModelMock, { id: 'file_1', url: 'https://r2.example/f.png' });

    const runtime = createRuntime();
    const result = await (runtime as any).deleteFile({ id: 'file_1' });

    expect(fileModelMock.findById).toHaveBeenCalledWith('file_1');
    expect(fileModelMock.delete).toHaveBeenCalledWith('file_1', {
      removeGlobalFile: expect.any(Boolean),
    });
    expect(fileServiceMock.deleteFile).toHaveBeenCalledWith('https://r2.example/f.png');
    expect(result.success).toBe(true);
  });

  it('throws NOT-found when the file does not exist and skips deletion', async () => {
    const { FileModel } = await import('@/database/models/file');
    const { FileService } = await import('@/server/services/file');
    const fileModelMock: any = new (FileModel as any)();
    const fileServiceMock: any = new (FileService as any)();
    setupFileModel(fileModelMock, null);

    const runtime = createRuntime();
    const result = await (runtime as any).deleteFile({ id: 'file_missing' });

    expect(fileModelMock.delete).not.toHaveBeenCalled();
    expect(fileServiceMock.deleteFile).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.content).toContain('not found');
  });
});
