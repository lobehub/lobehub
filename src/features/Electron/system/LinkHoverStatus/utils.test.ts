import { describe, expect, it } from 'vitest';

import { externalLinkHref, truncateUrl } from './utils';

describe('externalLinkHref', () => {
  it('keeps http(s) links', () => {
    expect(externalLinkHref('https://example.com/a')).toBe('https://example.com/a');
    expect(externalLinkHref('HTTP://example.com')).toBe('HTTP://example.com');
  });

  it('rejects internal and non-web hrefs', () => {
    expect(externalLinkHref('/settings')).toBeNull();
    expect(externalLinkHref('#anchor')).toBeNull();
    expect(externalLinkHref('javascript:void(0)')).toBeNull();
    expect(externalLinkHref('mailto:a@example.com')).toBeNull();
    expect(externalLinkHref(null)).toBeNull();
    expect(externalLinkHref('')).toBeNull();
  });
});

describe('truncateUrl', () => {
  it('returns short urls unchanged', () => {
    expect(truncateUrl('https://example.com')).toBe('https://example.com');
  });

  it('truncates the middle of long urls', () => {
    const url = `https://example.com/${'a'.repeat(200)}/tail-segment`;
    const out = truncateUrl(url);
    expect(out).toHaveLength(100);
    expect(out.startsWith('https://example.com/')).toBe(true);
    expect(out).toContain('…');
    expect(out.endsWith(url.slice(-30))).toBe(true);
  });
});
