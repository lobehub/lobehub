import { describe, expect, it } from 'vitest';

import { withNoStore } from './cacheControl';

describe('withNoStore', () => {
  it('adds Cache-Control: no-store to a response without a cache policy', () => {
    const response = new Response('secret', { status: 200 });

    const result = withNoStore(response);

    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });

  it('preserves status, statusText and other headers', () => {
    const response = new Response(null, {
      headers: { 'Location': '/oauth/callback/success', 'X-Custom': '1' },
      status: 307,
      statusText: 'Temporary Redirect',
    });

    const result = withNoStore(response);

    expect(result.status).toBe(307);
    expect(result.statusText).toBe('Temporary Redirect');
    expect(result.headers.get('Location')).toBe('/oauth/callback/success');
    expect(result.headers.get('X-Custom')).toBe('1');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });

  it('passes the body through unchanged', async () => {
    const response = new Response(JSON.stringify({ keyVaults: { apiKey: 'x' } }));

    const result = withNoStore(response);

    expect(await result.text()).toBe(JSON.stringify({ keyVaults: { apiKey: 'x' } }));
  });

  it('does not override an explicit cache policy', () => {
    const response = new Response('public', {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });

    const result = withNoStore(response);

    expect(result).toBe(response);
    expect(result.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });
});
