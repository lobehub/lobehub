import { describe, expect, it } from 'vitest';

import { applyUrlRules } from '../appUrlRules';

describe('applyUrlRules', () => {
  // @gru-agent github file rules 不要改
  it('github file rules', () => {
    const result = applyUrlRules(
      'https://github.com/lobehub/chat-plugin-web-crawler/blob/main/api/v1/_utils.ts',
      [
        {
          filterOptions: {
            enableReadability: false,
          },
          urlPattern: 'https://github.com/([^/]+)/([^/]+)/blob/([^/]+)/(.*)',
          urlTransform: 'https://github.com/$1/$2/raw/refs/heads/$3/$4',
        },
      ],
    );

    expect(result).toEqual({
      filterOptions: {
        enableReadability: false,
      },
      transformedUrl:
        'https://github.com/lobehub/chat-plugin-web-crawler/raw/refs/heads/main/api/v1/_utils.ts',
    });
  });

  it('should return original url when no rules match', () => {
    const result = applyUrlRules('https://example.com', [
      {
        urlPattern: 'https://github.com/.*',
      },
    ]);

    expect(result).toEqual({
      transformedUrl: 'https://example.com',
    });
  });

  it('should return original url with filter options when rule matches without transform', () => {
    const result = applyUrlRules('https://example.com', [
      {
        filterOptions: { pureText: true },
        urlPattern: 'https://example.com',
      },
    ]);

    expect(result).toEqual({
      filterOptions: { pureText: true },
      transformedUrl: 'https://example.com',
    });
  });

  it('should apply first matching rule when multiple rules match', () => {
    const result = applyUrlRules('https://example.com/test', [
      {
        filterOptions: { pureText: true },
        urlPattern: 'https://example.com/(.*)',
        urlTransform: 'https://example.com/transformed/$1',
      },
      {
        filterOptions: { enableReadability: true },
        urlPattern: 'https://example.com/.*',
        urlTransform: 'https://example.com/other',
      },
    ]);

    expect(result).toEqual({
      filterOptions: { pureText: true },
      transformedUrl: 'https://example.com/transformed/test',
    });
  });

  it('should handle special characters in URLs and patterns', () => {
    const result = applyUrlRules('https://example.com/path?q=1&b=2#hash', [
      {
        urlPattern: 'https://example.com/([^?#]+)[?#]?.*',
        urlTransform: 'https://example.com/clean/$1',
      },
    ]);

    expect(result).toEqual({
      transformedUrl: 'https://example.com/clean/path',
    });
  });

  it('should handle impls in rules', () => {
    const result = applyUrlRules('https://example.com', [
      {
        filterOptions: { pureText: true },
        impls: ['naive', 'browserless'],
        urlPattern: 'https://example.com',
      },
    ]);

    expect(result).toEqual({
      filterOptions: { pureText: true },
      impls: ['naive', 'browserless'],
      transformedUrl: 'https://example.com',
    });
  });
});
