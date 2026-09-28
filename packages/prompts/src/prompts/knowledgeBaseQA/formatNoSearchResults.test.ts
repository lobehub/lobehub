import { describe, expect, it } from 'vitest';

import { promptNoKnowledgeBaseInScope, promptNoSearchResults } from './formatNoSearchResults';

describe('promptNoSearchResults', () => {
  it('should format no search results with simple query', () => {
    const result = promptNoSearchResults('how to install');
    expect(result).toMatchSnapshot();
  });

  it('should format no search results with complex query', () => {
    const result = promptNoSearchResults('API authentication with OAuth 2.0');
    expect(result).toMatchSnapshot();
  });

  it('should format no search results with special characters', () => {
    const result = promptNoSearchResults('How to use fetchData<T> with async/await?');
    expect(result).toMatchSnapshot();
  });

  it('should format no search results with non-English query', () => {
    const result = promptNoSearchResults('如何配置数据库连接');
    expect(result).toMatchSnapshot();
  });
});

describe('promptNoKnowledgeBaseInScope', () => {
  it('only suggests tools conditionally and always offers a user-facing fallback', () => {
    // Graph-agent nodes can expose searchKnowledgeBase without the other KB APIs.
    const prompt = promptNoKnowledgeBaseInScope('Project Falcon ships');

    expect(prompt).toContain('searchedKnowledgeBases="0"');
    expect(prompt).toContain('If readKnowledge is among your available tools');
    expect(prompt).toContain(
      'If listKnowledgeBases / viewKnowledgeBase are among your available tools',
    );
    expect(prompt).toContain('Otherwise, tell the user nothing was searched');
    expect(prompt).not.toMatch(/<suggestion>Call /);
  });

  it('covers attached-but-disabled libraries instead of claiming none is attached', () => {
    // The scope resolver drops disabled libraries (`k.enabled`), so an empty scope can mean
    // "attached but turned off"; the remedy must include enabling it.
    const prompt = promptNoKnowledgeBaseInScope('Project Falcon ships');

    expect(prompt).toContain('No enabled knowledge base is in this agent');
    expect(prompt).toContain('the attached ones are turned off');
    expect(prompt).toContain('or turn on the one already attached');
    expect(prompt).not.toContain('No knowledge base is attached to this agent');
  });
});
