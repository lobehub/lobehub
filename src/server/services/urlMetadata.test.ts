import { createServer as createHttpServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import {
  clearUrlMetadataCaches,
  consumeUrlMetadataRateLimit,
  extractUrlMetadata,
  fetchUrlMetadata,
  getLobeDocumentIdentifierFromUrl,
  getUrlMetadataCacheSize,
  getUrlMetadataRateLimitBucketCount,
  isBlockedUrlMetadataAddress,
} from './urlMetadata';

describe('urlMetadata', () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 as const }];

  it('deduplicates concurrent requests and caches metadata for a short TTL', async () => {
    clearUrlMetadataCaches();
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const options = { cacheTtlMs: 10, lookupImpl: publicLookup, fetchImpl };

    const first = fetchUrlMetadata('https://example.com/article', options);
    const second = fetchUrlMetadata('https://example.com/article', options);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFetch?.(
      new Response('<html><head><title>Cached page</title></head></html>', {
        headers: { 'content-type': 'text/html' },
      }),
    );
    await expect(first).resolves.toMatchObject({ title: 'Cached page' });
    await expect(second).resolves.toMatchObject({ title: 'Cached page' });
    await expect(
      fetchUrlMetadata('https://example.com/article', { ...options, cacheTtlMs: 10 }),
    ).resolves.toMatchObject({ title: 'Cached page' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clearUrlMetadataCaches();
  });

  it('pins every redirect hop to the address that passed the DNS check', async () => {
    clearUrlMetadataCaches();
    const lookupImpl = vi
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 as const }])
      .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 as const }]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { location: 'https://redirect.example.com/final' },
          status: 302,
        }),
      )
      .mockResolvedValueOnce(
        new Response('<html><head><title>Pinned page</title></head></html>', {
          headers: { 'content-type': 'text/html' },
        }),
      );

    await expect(
      fetchUrlMetadata('https://example.com/start', {
        cache: false,
        fetchImpl,
        lookupImpl,
      }),
    ).resolves.toMatchObject({ title: 'Pinned page' });
    expect(lookupImpl).toHaveBeenNthCalledWith(1, 'example.com', {
      all: true,
      verbatim: true,
    });
    expect(lookupImpl).toHaveBeenNthCalledWith(2, 'redirect.example.com', {
      all: true,
      verbatim: true,
    });
    expect(fetchImpl.mock.calls[0][1]).toHaveProperty('dispatcher');
    expect(fetchImpl.mock.calls[1][1]).toHaveProperty('dispatcher');
    clearUrlMetadataCaches();
  });

  it('cleans expired cache entries and evicts the oldest entry at capacity', async () => {
    clearUrlMetadataCaches();
    let clock = 0;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(input).pathname;
      return new Response(`<html><head><title>${url}</title></head></html>`, {
        headers: { 'content-type': 'text/html' },
      });
    });
    const options = {
      cacheMaxEntries: 2,
      cacheTtlMs: 10,
      fetchImpl,
      lookupImpl: publicLookup,
      now: () => clock,
    };

    await fetchUrlMetadata('https://example.com/one', options);
    await fetchUrlMetadata('https://example.com/two', options);
    expect(getUrlMetadataCacheSize()).toBe(2);

    clock = 11;
    await fetchUrlMetadata('https://example.com/three', options);
    expect(getUrlMetadataCacheSize()).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await fetchUrlMetadata('https://example.com/three', options);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await fetchUrlMetadata('https://example.com/one', options);
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    await fetchUrlMetadata('https://example.com/four', options);
    await fetchUrlMetadata('https://example.com/five', options);
    expect(getUrlMetadataCacheSize()).toBe(2);
    await fetchUrlMetadata('https://example.com/three', options);
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    clearUrlMetadataCaches();
  });

  it('uses the pinned lookup with the real Undici fetch implementation', async () => {
    const httpServer = createHttpServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end('<html><head><title>Local pinned response</title></head></html>');
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('HTTP test server did not start');

    try {
      await expect(
        fetchUrlMetadata(`http://localhost:${address.port}/`, {
          allowLocalhost: true,
          cache: false,
          lookupImpl: async () => [{ address: '127.0.0.1', family: 4 as const }],
        }),
      ).resolves.toMatchObject({ title: 'Local pinned response' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('limits requests per user and resets the window', () => {
    clearUrlMetadataCaches();
    expect(consumeUrlMetadataRateLimit('user-1', 0, 2, 100).allowed).toBe(true);
    expect(consumeUrlMetadataRateLimit('user-1', 1, 2, 100).allowed).toBe(true);
    expect(consumeUrlMetadataRateLimit('user-1', 2, 2, 100)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(consumeUrlMetadataRateLimit('user-1', 100, 2, 100)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('cleans expired rate-limit buckets and never evicts active users at capacity', () => {
    clearUrlMetadataCaches();
    expect(consumeUrlMetadataRateLimit('active-user', 0, 1, 100, 1)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(consumeUrlMetadataRateLimit('active-user', 1, 1, 100, 1).allowed).toBe(false);
    expect(consumeUrlMetadataRateLimit('new-user', 1, 1, 100, 1)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(getUrlMetadataRateLimitBucketCount()).toBe(1);

    expect(consumeUrlMetadataRateLimit('new-user', 100, 1, 100, 1)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(getUrlMetadataRateLimitBucketCount()).toBe(1);
    clearUrlMetadataCaches();
  });

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
