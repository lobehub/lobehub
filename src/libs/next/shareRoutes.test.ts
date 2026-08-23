import { describe, expect, it } from 'vitest';

import { isShareSpaRoute } from './shareRoutes';

describe('isShareSpaRoute', () => {
  it.each(['/share/t/abc', '/share/t/abc/', '/share/page/docs_1', '/share/t/abc?hl=zh-CN'])(
    'matches %s',
    (pathname) => {
      expect(isShareSpaRoute(pathname)).toBe(true);
    },
  );

  it.each([
    '/share',
    '/share/',
    '/share/t',
    '/share/t/abc/extra',
    '/shared/t/abc',
    '/chat',
    '/verify/run-1',
  ])('does not match %s', (pathname) => {
    expect(isShareSpaRoute(pathname)).toBe(false);
  });
});
