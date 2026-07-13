import { describe, expect, it } from 'vitest';

import { createBrowserContext, normalizeBrowserUrl } from './utils';

describe('normalizeBrowserUrl', () => {
  it('keeps explicit http URLs', () => {
    expect(normalizeBrowserUrl('https://lobehub.com')).toBe('https://lobehub.com');
  });

  it('normalizes hostnames and local dev URLs', () => {
    expect(normalizeBrowserUrl('lobehub.com')).toBe('https://lobehub.com');
    expect(normalizeBrowserUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeBrowserUrl('127.0.0.1:9876')).toBe('http://127.0.0.1:9876');
  });

  it('turns plain text into a search URL', () => {
    expect(normalizeBrowserUrl('lobe browser feature')).toBe(
      'https://www.bing.com/search?q=lobe+browser+feature',
    );
  });
});

describe('createBrowserContext', () => {
  it('creates a selected-text context with its page source', () => {
    expect(
      createBrowserContext({
        content: '  Selected pull request feedback  ',
        id: 'context-1',
        pageTitle: 'Pull request #17159',
        selected: true,
        selectionTitle: 'Selected text',
        url: 'https://github.com/lobehub/lobehub/pull/17159',
      }),
    ).toEqual({
      content:
        'Source: https://github.com/lobehub/lobehub/pull/17159\n\nSelected pull request feedback',
      format: 'text',
      id: 'context-1',
      preview: 'Selected pull request feedback',
      source: 'text',
      title: 'Selected text: Pull request #17159',
      type: 'text',
    });
  });

  it('creates a page context and truncates its preview', () => {
    const content = 'A'.repeat(100);
    const context = createBrowserContext({
      content,
      id: 'context-2',
      pageTitle: 'LobeHub',
      selected: false,
      selectionTitle: 'Selected text',
      url: 'https://lobehub.com',
    });

    expect(context.title).toBe('LobeHub');
    expect(context.preview).toBe(`${'A'.repeat(80)}...`);
    expect(context.content).toBe(`Source: https://lobehub.com\n\n${content}`);
  });
});
