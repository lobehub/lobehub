import { describe, expect, it } from 'vitest';

import { withNoIndexHeader } from './headers';

describe('withNoIndexHeader', () => {
  it('keeps rendered documents out of search results', async () => {
    const response = withNoIndexHeader(
      new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    );

    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toBe('<html></html>');
  });

  it('covers responses that render no head, such as llm.txt and errors', async () => {
    const text = withNoIndexHeader(new Response('# Shared topic'));
    const failure = withNoIndexHeader(new Response('Internal Server Error', { status: 500 }));

    expect(text.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(failure.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(failure.status).toBe(500);
    await expect(text.text()).resolves.toBe('# Shared topic');
  });

  it('leaves redirects to the marketing site intact', () => {
    const response = withNoIndexHeader(
      new Response(null, { headers: { location: 'https://lobehub.com' }, status: 302 }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://lobehub.com');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});
