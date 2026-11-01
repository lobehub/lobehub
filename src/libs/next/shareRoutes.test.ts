import { describe, expect, it } from 'vitest';

import { isShareSpaRoute, SHARE_NO_INDEX_DIRECTIVE, withShareNoIndexHeader } from './shareRoutes';

describe('isShareSpaRoute', () => {
  it.each([
    '/share/t/abc',
    '/share/t/abc/',
    '/share/page/docs_1',
    '/share/t/abc?hl=zh-CN',
    '/share/artifact/42',
    '/share/artifact/42/',
  ])('matches %s', (pathname) => {
    expect(isShareSpaRoute(pathname)).toBe(true);
  });

  it.each([
    '/share',
    '/share/',
    '/share/t',
    '/share/artifact',
    '/share/t/abc/extra',
    '/shared/t/abc',
    '/chat',
    '/verify/run-1',
  ])('does not match %s', (pathname) => {
    expect(isShareSpaRoute(pathname)).toBe(false);
  });
});

describe('withShareNoIndexHeader', () => {
  it('keeps a rendered share document out of search results', async () => {
    const response = withShareNoIndexHeader(
      new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    );

    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toBe('<html></html>');
  });

  it('covers responses that render no head', () => {
    const response = withShareNoIndexHeader(new Response('Not Found', { status: 404 }));

    expect(response.headers.get('X-Robots-Tag')).toBe(SHARE_NO_INDEX_DIRECTIVE);
    expect(response.status).toBe(404);
  });
});
