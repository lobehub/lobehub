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
    expect(result.content).toContain('No knowledge base is attached to this agent');
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
    expect(result.content).toContain('No knowledge base is attached to this agent');
    expect(result.state).toMatchObject({ scope: 'none' });
  });

  it('keeps the "no relevant files" message when an attached knowledge base has no match', async () => {
    const { runtime } = createRuntime({ ...emptySearch, searchedKnowledgeBaseIds: ['kb_sales'] });

    const result = await runtime.searchKnowledgeBase(
      { query: 'quarterly revenue forecast' },
      { knowledgeBaseIds: ['kb_sales'] },
    );

    expect(result.content).toContain('No relevant files found');
    expect(result.content).not.toContain('No knowledge base is attached');
    expect(result.state).not.toHaveProperty('scope');
  });
});
