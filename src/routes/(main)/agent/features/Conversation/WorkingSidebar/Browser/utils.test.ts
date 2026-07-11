import { describe, expect, it } from 'vitest';

import { normalizeBrowserUrl } from './utils';

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
