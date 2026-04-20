// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { Search1APIImpl } from './index';

// Integration test — requires SEARCH1API_API_KEY env var
const apiKey = process.env.SEARCH1API_SEARCH_API_KEY;
const describeIfKey = apiKey ? describe : describe.skip;

describeIfKey('Search1APIImpl integration', { timeout: 30_000 }, () => {
  const impl = new Search1APIImpl();

  it('should return search results for a basic query', async () => {
    const result = await impl.query('LobeHub');

    expect(result.query).toBe('LobeHub');
    expect(result.resultNumbers).toBeGreaterThan(0);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.costTime).toBeGreaterThan(0);

    const firstResult = result.results[0];
    expect(firstResult.url).toBeDefined();
    expect(firstResult.title).toBeDefined();
    expect(firstResult.parsedUrl).toBeDefined();
  });

  it('should respect searchTimeRange param', async () => {
    const result = await impl.query('latest AI news', {
      searchTimeRange: 'day',
    });

    expect(result.query).toBe('latest AI news');
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('should support multiple search engines', async () => {
    const result = await impl.query('TypeScript', {
      searchEngines: ['google', 'bing'],
    });

    expect(result.query).toBe('TypeScript');
    expect(result.resultNumbers).toBeGreaterThan(0);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('should return valid URL structures in results', async () => {
    const result = await impl.query('GitHub');

    for (const item of result.results) {
      expect(item.url).toMatch(/^https?:\/\//);
      expect(item.parsedUrl).toBeTruthy();
      expect(typeof item.title).toBe('string');
      expect(typeof item.content).toBe('string');
      expect(typeof item.score).toBe('number');
      expect(item.category).toBe('general');
    }
  });

  it('should handle single search engine param', async () => {
    const result = await impl.query('OpenAI', {
      searchEngines: ['google'],
    });

    expect(result.results.length).toBeGreaterThan(0);
    // When single engine specified, engines field should contain it
    expect(result.results[0].engines).toContain('google');
  });

  it('should handle single engine with week time range', async () => {
    const result = await impl.query('latest open source AI frameworks', {
      searchEngines: ['google'],
      searchTimeRange: 'week',
    });

    expect(result.query).toBe('latest open source AI frameworks');
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('should handle multiple engines with week time range', async () => {
    const result = await impl.query('best practices for TypeScript monorepo setup', {
      searchEngines: ['google', 'bing'],
      searchTimeRange: 'week',
    });

    expect(result.query).toBe('best practices for TypeScript monorepo setup');
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  });
});
