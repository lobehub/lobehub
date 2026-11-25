import { SSRFBlockedError } from '@lobechat/ssrf-safe-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkPreviewUnavailableError } from './errors';
import { getLinkPreview, normalizeLinkPreviewUrl } from './index';

const { ssrfSafeFetch } = vi.hoisted(() => ({ ssrfSafeFetch: vi.fn() }));
vi.mock('@lobechat/ssrf-safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ssrfSafeFetch,
}));
vi.mock('@/server/services/redis', () => ({
  redisService: {
    linkPreview: {
      remember: async (_url: string, resolve: () => Promise<unknown>) => {
        try {
          return await resolve();
        } catch (error) {
          throw new LinkPreviewUnavailableError({ cause: error });
        }
      },
    },
  },
}));

const htmlResponse = (body: string | Uint8Array, contentType = 'text/html; charset=utf-8') =>
  new Response(body, { headers: { 'content-type': contentType }, status: 200 });

describe('normalizeLinkPreviewUrl', () => {
  it('keeps public web addresses without their fragment', () => {
    expect(normalizeLinkPreviewUrl('https://example.com/a?b=1#c')).toBe(
      'https://example.com/a?b=1',
    );
  });

  it('refuses other schemes, credentials and oversized addresses', () => {
    expect(normalizeLinkPreviewUrl('file:///etc/passwd')).toBe(null);
    expect(normalizeLinkPreviewUrl('https://user:secret@example.com/')).toBe(null);
    expect(normalizeLinkPreviewUrl(`https://example.com/${'a'.repeat(2100)}`)).toBe(null);
    expect(normalizeLinkPreviewUrl('not a url')).toBe(null);
  });
});

describe('getLinkPreview', () => {
  beforeEach(() => {
    ssrfSafeFetch.mockReset();
  });

  it('reads the card through the SSRF guard with a bounded body', async () => {
    ssrfSafeFetch.mockResolvedValue(
      htmlResponse('<head><meta property="og:title" content="Hello"></head>'),
    );

    await expect(getLinkPreview('https://example.com/post#top')).resolves.toEqual({
      title: 'Hello',
      url: 'https://example.com/post',
    });
    expect(ssrfSafeFetch).toHaveBeenCalledWith(
      'https://example.com/post',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      // Public hosts only, whatever exceptions the deployment grants other fetches.
      { allowIPAddressList: [], allowPrivateIPAddress: false, maxContentLength: 512 * 1024 },
    );
  });

  it('resolves a relative image against the page a redirect landed on', async () => {
    ssrfSafeFetch
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { location: 'https://www.example.com/articles/x' },
          status: 301,
        }),
      )
      .mockResolvedValueOnce(
        htmlResponse(
          '<head><meta property="og:title" content="X"><meta property="og:image" content="cover.jpg"></head>',
        ),
      );

    await expect(getLinkPreview('https://example.com/x')).resolves.toEqual({
      image: 'https://www.example.com/articles/cover.jpg',
      title: 'X',
      url: 'https://example.com/x',
    });
    expect(ssrfSafeFetch).toHaveBeenLastCalledWith(
      'https://www.example.com/articles/x',
      expect.objectContaining({ redirect: 'manual' }),
      expect.anything(),
    );
  });

  it('gives up on redirect loops and redirects to non-web addresses', async () => {
    ssrfSafeFetch.mockImplementation(
      async () => new Response(null, { headers: { location: '/again' }, status: 302 }),
    );
    await expect(getLinkPreview('https://loop.example.com/')).resolves.toBe(null);
    expect(ssrfSafeFetch).toHaveBeenCalledTimes(6);

    ssrfSafeFetch.mockReset();
    ssrfSafeFetch.mockResolvedValueOnce(
      new Response(null, { headers: { location: 'file:///etc/passwd' }, status: 302 }),
    );
    await expect(getLinkPreview('https://example.com/')).resolves.toBe(null);
    expect(ssrfSafeFetch).toHaveBeenCalledTimes(1);
  });

  it('decodes the charset the page declares', async () => {
    // "标题" in GBK.
    const gbk = new Uint8Array([
      ...new TextEncoder().encode('<head><title>'),
      0xb1,
      0xea,
      0xcc,
      0xe2,
      ...new TextEncoder().encode('</title></head>'),
    ]);
    ssrfSafeFetch.mockResolvedValue(htmlResponse(gbk, 'text/html; charset=GBK'));

    await expect(getLinkPreview('https://example.cn/')).resolves.toMatchObject({ title: '标题' });
  });

  it('answers no card for non-HTML pages, missing pages and private hosts', async () => {
    ssrfSafeFetch.mockResolvedValueOnce(htmlResponse('%PDF', 'application/pdf'));
    await expect(getLinkPreview('https://example.com/a.pdf')).resolves.toBe(null);

    ssrfSafeFetch.mockResolvedValueOnce(new Response('gone', { status: 404 }));
    await expect(getLinkPreview('https://example.com/gone')).resolves.toBe(null);

    ssrfSafeFetch.mockRejectedValueOnce(new SSRFBlockedError('SSRF blocked: 10.0.0.1'));
    await expect(getLinkPreview('http://internal.example.com/')).resolves.toBe(null);
  });

  it('reports a page it could not read as unavailable, not as having no card', async () => {
    ssrfSafeFetch.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));

    await expect(getLinkPreview('https://slow.example.com/')).rejects.toBeInstanceOf(
      LinkPreviewUnavailableError,
    );
  });

  it('never fetches an address that cannot have a card', async () => {
    await expect(getLinkPreview('ftp://example.com/')).resolves.toBe(null);
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });
});
