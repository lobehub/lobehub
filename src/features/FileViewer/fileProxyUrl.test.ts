import { describe, expect, it } from 'vitest';

import { toSameOriginFileProxyUrl } from './fileProxyUrl';

describe('toSameOriginFileProxyUrl', () => {
  const origin = window.location.origin;

  it('rewrites a cross-origin file proxy URL to the current origin', () => {
    expect(toSameOriginFileProxyUrl('https://app.lobehub.com/f/file_k9D0pniGzVIW')).toBe(
      `${origin}/f/file_k9D0pniGzVIW`,
    );
  });

  it('keeps same-origin and relative proxy URLs untouched', () => {
    expect(toSameOriginFileProxyUrl(`${origin}/f/file_abc`)).toBe(`${origin}/f/file_abc`);
    expect(toSameOriginFileProxyUrl('/f/file_abc')).toBe('/f/file_abc');
  });

  it('keeps signed storage and other non-proxy URLs untouched', () => {
    const signed = 'https://bucket.r2.cloudflarestorage.com/files/a.md?X-Amz-Signature=x';
    expect(toSameOriginFileProxyUrl(signed)).toBe(signed);
    expect(toSameOriginFileProxyUrl('https://example.com/f/file_abc/raw')).toBe(
      'https://example.com/f/file_abc/raw',
    );
    expect(toSameOriginFileProxyUrl('https://example.com/f/file_abc?x=1')).toBe(
      'https://example.com/f/file_abc?x=1',
    );
    expect(toSameOriginFileProxyUrl('blob:https://example.com/123')).toBe(
      'blob:https://example.com/123',
    );
  });
});
