// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createFileNotFoundResponse } from './notFoundResponse';

vi.mock('@lobechat/business-const', () => ({
  BRANDING_NAME: 'TITU <Work>',
  BRANDING_WORDMARK_URL: '/branding/tituwork_light.svg',
}));

const browser = new Request('https://example.com/f/missing', { headers: { accept: 'text/html' } });

describe('createFileNotFoundResponse', () => {
  it('renders the branded page with the wordmark and an escaped name', async () => {
    const response = createFileNotFoundResponse(browser);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(html).toContain('<img src="/branding/tituwork_light.svg"');
    expect(html).toContain('返回 TITU &#60;Work&#62;');
    expect(html).not.toContain('<Work>');
  });

  it('keeps caller headers on both bodies', async () => {
    const init = { headers: { 'Cache-Control': 'private, no-store' } };
    const html = createFileNotFoundResponse(browser, init);
    const text = createFileNotFoundResponse(new Request('https://example.com/f/x'), init);

    expect(html.headers.get('cache-control')).toBe('private, no-store');
    expect(text.headers.get('cache-control')).toBe('private, no-store');
    expect(await text.text()).toBe('File not found');
  });
});
