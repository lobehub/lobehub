import { describe, expect, it, vi } from 'vitest';

import { KnowledgeBaseExecutionRuntime } from './index';

const emptySearch = { chunks: [], documents: [], fileResults: [] };

const createRuntime = (searchResult: Record<string, unknown> = emptySearch) => {
  const ragService = {
    getFileContents: vi.fn(),
    semanticSearchForChat: vi.fn(async () => searchResult as any),
  };
  return { ragService, runtime: new KnowledgeBaseExecutionRuntime(ragService) };
};

describe('KnowledgeBaseExecutionRuntime.searchKnowledgeBase', () => {
  it('tells the model no knowledge base is attached when the service searched an empty scope', async () => {
    const { runtime } = createRuntime({ ...emptySearch, searchedKnowledgeBaseIds: [] });

    const result = await runtime.searchKnowledgeBase({ query: 'quarterly revenue forecast' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('No enabled knowledge base is in this agent');
    expect(result.content).toContain('readKnowledge');
    expect(result.content).not.toContain('No relevant files found');
    // The card and chip read this to say "no library attached" instead of "No results".
    expect(result.state).toMatchObject({ scope: 'none', totalResults: 0 });
  });

  it('skips the search entirely when the caller passes an empty knowledge base scope', async () => {
    const { ragService, runtime } = createRuntime();

    const result = await runtime.searchKnowledgeBase(
      { query: 'quarterly revenue forecast' },
      { knowledgeBaseIds: [] },
    );

    expect(ragService.semanticSearchForChat).not.toHaveBeenCalled();
    expect(result.content).toContain('No enabled knowledge base is in this agent');
    expect(result.state).toMatchObject({ scope: 'none' });
  });

  it('keeps the "no relevant files" message when an attached knowledge base has no match', async () => {
    const { runtime } = createRuntime({ ...emptySearch, searchedKnowledgeBaseIds: ['kb_sales'] });

    const result = await runtime.searchKnowledgeBase(
      { query: 'quarterly revenue forecast' },
      { knowledgeBaseIds: ['kb_sales'] },
    );

    expect(result.content).toContain('No relevant files found');
    expect(result.content).not.toContain('No enabled knowledge base');
    expect(result.state).not.toHaveProperty('scope');
  });

  describe('when nothing matched, it says what the libraries let search read', () => {
    const indexStatus = (status: Record<string, unknown>) => ({
      embeddedFiles: 0,
      keywordOnlyItems: 0,
      unindexedFiles: 0,
      unindexedFileSamples: [],
      ...status,
    });

    it('fails with a typed error when no file in the libraries is indexed', async () => {
      const status = indexStatus({
        unindexedFileSamples: [{ id: 'file_env', name: 'environment-variables.mdx' }],
        unindexedFiles: 20,
      });
      const { runtime } = createRuntime({
        ...emptySearch,
        indexStatus: status,
        searchedKnowledgeBaseIds: ['kb_docs'],
      });

      const result = await runtime.searchKnowledgeBase({ query: '环境变量 OPENAI_API_KEY 配置' });

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({
        code: 'KNOWLEDGE_BASE_NOT_INDEXED',
        indexStatus: status,
        type: 'KnowledgeBaseNotIndexed',
      });
      expect(result.content).toContain('status="not_indexed"');
      expect(result.content).toContain('This does NOT mean the content is missing');
      expect(result.content).toContain('<file id="file_env" name="environment-variables.mdx" />');
      expect(result.content).not.toContain('No relevant files found');
      expect(result.state).toMatchObject({ indexStatus: status, status: 'not_indexed' });
    });

    it('tells the model a keyword-only library needs the words the items contain', async () => {
      const status = indexStatus({ keywordOnlyItems: 20 });
      const { runtime } = createRuntime({ ...emptySearch, indexStatus: status });

      const result = await runtime.searchKnowledgeBase({ query: 'deploy guide' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('No relevant files found');
      expect(result.content).toContain(
        '<index_status embeddedFiles="0" keywordOnlyItems="20" unindexedFiles="0" />',
      );
      expect(result.content).toContain('this search matched keywords only');
      expect(result.state).toMatchObject({ indexStatus: status, totalResults: 0 });
      expect(result.state).not.toHaveProperty('status');
    });

    it('lists the unindexed files of a partly indexed library', async () => {
      const status = indexStatus({
        embeddedFiles: 3,
        unindexedFileSamples: [{ id: 'file_new', name: 'new "draft".md' }],
        unindexedFiles: 1,
      });
      const { runtime } = createRuntime({ ...emptySearch, indexStatus: status });

      const result = await runtime.searchKnowledgeBase({ query: 'release plan' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('1 uploaded file(s) are not indexed');
      expect(result.content).toContain('<file id="file_new" name="new &quot;draft&quot;.md" />');
      expect(result.content).not.toContain('matched keywords only');
    });
  });
});
