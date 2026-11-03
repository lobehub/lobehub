import { describe, expect, it } from 'vitest';

import { getWebSearchOutput, getWebSearchQuery, getWebSearchResults } from './webSearchUtils';

describe('getWebSearchQuery', () => {
  it('reads the completed Codex web_search query from plugin state action', () => {
    expect(
      getWebSearchQuery({
        action: {
          query: 'OpenAI Codex CLI install official documentation',
          type: 'search',
        },
        status: 'completed',
      }),
    ).toBe('OpenAI Codex CLI install official documentation');
  });

  it('reads the completed Codex web_search query from action queries', () => {
    expect(
      getWebSearchQuery({
        action: {
          queries: ['OpenAI Codex CLI install official documentation'],
          type: 'search',
        },
        status: 'completed',
      }),
    ).toBe('OpenAI Codex CLI install official documentation');
  });

  it('keeps direct args query as the first match', () => {
    expect(
      getWebSearchQuery({
        action: { query: 'completed query' },
        query: 'streaming query',
      }),
    ).toBe('streaming query');
  });
});

describe('getWebSearchResults', () => {
  it('parses search results from plugin state data', () => {
    expect(
      getWebSearchResults({
        action: {
          results: [
            {
              snippet: 'Official documentation',
              title: 'Codex docs',
              url: 'https://developers.openai.com/codex',
            },
          ],
        },
      }),
    ).toEqual([
      {
        snippet: 'Official documentation',
        title: 'Codex docs',
        url: 'https://developers.openai.com/codex',
      },
    ]);
  });
});

describe('getWebSearchOutput', () => {
  it('hides Codex fallback completion copy', () => {
    expect(getWebSearchOutput('Completed web_search.')).toBe('');
  });
});
