import { describe, expect, it } from 'vitest';

import { readableRoutePath } from './routePathDisplay';

describe('readableRoutePath', () => {
  it('decodes a percent-encoded task slug back to its readable title', () => {
    // What `location.pathname` returns for `/task/T-1/飞书适配器支持-post-图文消息`.
    const encoded =
      '/task/T-1/%E9%A3%9E%E4%B9%A6%E9%80%82%E9%85%8D%E5%99%A8%E6%94%AF%E6%8C%81-post-%E5%9B%BE%E6%96%87%E6%B6%88%E6%81%AF';

    expect(readableRoutePath(encoded)).toBe('/task/T-1/飞书适配器支持-post-图文消息');
  });

  it('leaves an already-readable path untouched', () => {
    expect(readableRoutePath('/task/T-2/ship-the-task-link-slug')).toBe(
      '/task/T-2/ship-the-task-link-slug',
    );
  });

  it('keeps reserved delimiters escaped so a segment cannot fake a path separator', () => {
    expect(readableRoutePath('/task/T-3/a%2Fb')).toBe('/task/T-3/a%2Fb');
  });

  it('falls back to the raw path on a malformed escape instead of throwing', () => {
    expect(readableRoutePath('/task/T-4/100%-done')).toBe('/task/T-4/100%-done');
  });
});
