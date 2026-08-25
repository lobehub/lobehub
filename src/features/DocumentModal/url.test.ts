import { describe, expect, it } from 'vitest';

import { buildDocumentModalUrl } from './url';

describe('buildDocumentModalUrl', () => {
  it('builds a canonical personal page URL independently of the current route', () => {
    expect(buildDocumentModalUrl('https://example.com', 'doc-1')).toBe(
      'https://example.com/page/doc-1',
    );
  });

  it('includes the active workspace slug', () => {
    expect(buildDocumentModalUrl('https://example.com', 'doc-1', 'acme')).toBe(
      'https://example.com/acme/page/doc-1',
    );
  });
});
