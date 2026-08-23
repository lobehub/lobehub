import { describe, expect, it } from 'vitest';

import {
  extractUrlMetadata,
  getLobeDocumentIdentifierFromUrl,
  isBlockedUrlMetadataAddress,
} from './urlMetadata';

describe('urlMetadata', () => {
  it('extracts title, description and a resolved favicon', () => {
    const metadata = extractUrlMetadata(
      `<!doctype html><html><head>
        <title>Fallback title</title>
        <meta property="og:title" content="Lobe Editor 验收" />
        <meta property="og:image" content="/assets/social-card.png" />
        <meta name="description" content="URL 元数据服务返回的描述" />
        <link rel="icon" href="/assets/logo.png" />
      </head></html>`,
      'https://example.com/docs/page',
    );

    expect(metadata).toEqual({
      description: 'URL 元数据服务返回的描述',
      icon: 'https://example.com/assets/logo.png',
      title: 'Lobe Editor 验收',
      url: 'https://example.com/docs/page',
    });
  });

  it('falls back to the target origin favicon instead of using og:image', () => {
    const metadata = extractUrlMetadata(
      '<html><head><title>GitHub</title><meta property="og:image" content="/social.png" /></head></html>',
      'https://github.com/lobehub/lobe-editor',
    );

    expect(metadata.icon).toBe('https://github.com/favicon.ico');
  });

  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fd00::1'])(
    'blocks private address %s',
    (address) => {
      expect(isBlockedUrlMetadataAddress(address)).toBe(true);
    },
  );

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('allows public address %s', (address) => {
    expect(isBlockedUrlMetadataAddress(address)).toBe(false);
  });

  it('recognizes same-origin Page links', () => {
    expect(
      getLobeDocumentIdentifierFromUrl(
        'https://lobehub.com/page/docs_123',
        'https://lobehub.com/webapi/url-metadata',
      ),
    ).toBe('docs_123');
    expect(
      getLobeDocumentIdentifierFromUrl(
        'https://lobehub.com/share/page/abc',
        'https://lobehub.com/webapi/url-metadata',
      ),
    ).toBe('abc');
  });

  it('only treats loopback aliases as the same app in development', () => {
    expect(
      getLobeDocumentIdentifierFromUrl(
        'http://127.0.0.1:28168/page/abc',
        'http://localhost:28168/webapi/url-metadata',
        true,
      ),
    ).toBe('abc');
    expect(
      getLobeDocumentIdentifierFromUrl(
        'http://127.0.0.1:28168/page/abc',
        'http://localhost:28168/webapi/url-metadata',
      ),
    ).toBeUndefined();
  });
});
