import { describe, expect, it } from 'vitest';

import { buildFrameAncestorsDirective, normalizeEmbedOrigin, parseEmbedOrigins } from './origin';

describe('normalizeEmbedOrigin', () => {
  it('accepts bare origins and normalizes case, whitespace and a trailing slash', () => {
    expect(normalizeEmbedOrigin(' https://Example.com/ ')).toBe('https://example.com');
    expect(normalizeEmbedOrigin('http://localhost:5555')).toBe('http://localhost:5555');
    expect(normalizeEmbedOrigin('https://docs.example.co.uk')).toBe('https://docs.example.co.uk');
  });

  it('drops the default port of the scheme', () => {
    expect(normalizeEmbedOrigin('https://example.com:443')).toBe('https://example.com');
    expect(normalizeEmbedOrigin('http://example.com:80')).toBe('http://example.com');
    expect(normalizeEmbedOrigin('http://example.com:443')).toBe('http://example.com:443');
  });

  it('accepts one leading wildcard label over at least two labels', () => {
    expect(normalizeEmbedOrigin('https://*.example.com')).toBe('https://*.example.com');
    expect(normalizeEmbedOrigin('https://*.com')).toBeNull();
    expect(normalizeEmbedOrigin('https://a.*.example.com')).toBeNull();
  });

  it('rejects anything that is not a bare http(s) origin', () => {
    for (const value of [
      '',
      'example.com',
      'https://example.com/path',
      'https://example.com?x=1',
      'ftp://example.com',
      "https://example.com 'unsafe-inline'",
      'https://example.com; script-src *',
      '*',
      "'self'",
      'https://exa mple.com',
      'https://example.com:99999',
      'https://example.com:0',
      'https://user@example.com',
    ]) {
      expect(normalizeEmbedOrigin(value), value).toBeNull();
    }
  });
});

describe('parseEmbedOrigins', () => {
  it('dedupes by normalized origin, skips blanks and reports invalid entries as typed', () => {
    expect(
      parseEmbedOrigins(['https://a.com', ' ', 'HTTPS://A.com/', 'nope', 'http://localhost:3000']),
    ).toEqual({ invalid: ['nope'], origins: ['https://a.com', 'http://localhost:3000'] });
  });
});

describe('buildFrameAncestorsDirective', () => {
  it('lists the allowed origins', () => {
    expect(buildFrameAncestorsDirective(['https://a.com', 'https://*.b.com'])).toBe(
      'frame-ancestors https://a.com https://*.b.com',
    );
  });

  it('forbids framing when nothing valid is allowed', () => {
    expect(buildFrameAncestorsDirective(undefined)).toBe("frame-ancestors 'none'");
    expect(buildFrameAncestorsDirective([])).toBe("frame-ancestors 'none'");
    expect(buildFrameAncestorsDirective(['https://a.com; script-src *'])).toBe(
      "frame-ancestors 'none'",
    );
  });
});
