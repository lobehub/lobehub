import { describe, expect, it } from 'vitest';

import { buildQueryWithType, parseSearchQuery } from './queryParser';

describe('parseSearchQuery', () => {
  it('should parse query without type filter', () => {
    const result = parseSearchQuery('regular search');
    expect(result).toEqual({
      cleanQuery: 'regular search',
      typeFilter: undefined,
    });
  });

  it('should parse query with type: prefix', () => {
    const result = parseSearchQuery('type:agent my search');
    expect(result).toEqual({
      cleanQuery: 'my search',
      typeFilter: 'agent',
    });
  });

  it('should parse query with is: prefix', () => {
    const result = parseSearchQuery('is:message hello world');
    expect(result).toEqual({
      cleanQuery: 'hello world',
      typeFilter: 'message',
    });
  });

  it('should handle type filter at the end of query', () => {
    const result = parseSearchQuery('my search type:topic');
    expect(result).toEqual({
      cleanQuery: 'my search',
      typeFilter: 'topic',
    });
  });

  it('should handle type filter in the middle of query', () => {
    const result = parseSearchQuery('hello type:file world');
    expect(result).toEqual({
      cleanQuery: 'hello world',
      typeFilter: 'file',
    });
  });

  it('should handle case-insensitive type values', () => {
    const result = parseSearchQuery('type:AGENT search');
    expect(result).toEqual({
      cleanQuery: 'search',
      typeFilter: 'agent',
    });
  });

  it('should ignore invalid type values', () => {
    const result = parseSearchQuery('type:invalid search');
    expect(result).toEqual({
      cleanQuery: 'type:invalid search',
      typeFilter: undefined,
    });
  });

  it('should handle empty query', () => {
    const result = parseSearchQuery('');
    expect(result).toEqual({
      cleanQuery: '',
      typeFilter: undefined,
    });
  });

  it('should handle only type filter', () => {
    const result = parseSearchQuery('type:page');
    expect(result).toEqual({
      cleanQuery: '',
      typeFilter: 'page',
    });
  });

  it('should handle all valid types', () => {
    // Note: Only lowercase types work because the parser normalizes to lowercase
    // and VALID_TYPES comparison is case-sensitive
    const types = ['agent', 'topic', 'message', 'file', 'page', 'mcp', 'plugin'];

    for (const type of types) {
      const result = parseSearchQuery(`type:${type} search`);
      expect(result.typeFilter).toBe(type);
      expect(result.cleanQuery).toBe('search');
    }
  });

  it('should trim whitespace from clean query', () => {
    const result = parseSearchQuery('  type:agent   my search   ');
    expect(result).toEqual({
      cleanQuery: 'my search',
      typeFilter: 'agent',
    });
  });

  it('should handle multiple spaces in query', () => {
    const result = parseSearchQuery('type:agent    multiple    spaces');
    expect(result).toEqual({
      cleanQuery: 'multiple    spaces',
      typeFilter: 'agent',
    });
  });
});

describe('buildQueryWithType', () => {
  it('should build query with type filter', () => {
    const result = buildQueryWithType('my search', 'agent');
    expect(result).toBe('type:agent my search');
  });

  it('should handle empty query', () => {
    const result = buildQueryWithType('', 'agent');
    expect(result).toBe('type:agent');
  });

  it('should trim query', () => {
    const result = buildQueryWithType('  my search  ', 'topic');
    expect(result).toBe('type:topic my search');
  });
});
