import { describe, expect, it } from 'vitest';

import { createNodeResponse } from '../response';

describe('createNodeResponse', () => {
  it('wraps successful Response with default headers', async () => {
    const upstream = new Response('audio-chunk', {
      headers: {
        'x-source': 'sdk',
      },
      status: 201,
      statusText: 'Created',
    });
    upstream.headers.delete('content-type');

    const result = await createNodeResponse(() => Promise.resolve(upstream), {
      success: {
        cacheControl: 'no-store',
        defaultContentType: 'audio/mpeg',
      },
    });

    expect(await result.text()).toBe('audio-chunk');
    expect(result.status).toBe(201);
    expect(result.headers.get('x-source')).toBe('sdk');
    expect(result.headers.get('content-type')).toBe('audio/mpeg');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });

  it('delegates to onInvalidResponse when payload is not Response-like', async () => {
    const fallback = new Response('invalid', { status: 500 });

    const result = await createNodeResponse(() => Promise.resolve({} as any), {
      onInvalidResponse: () => fallback,
    });

    expect(result).toBe(fallback);
  });

  it('normalizes thrown Response-like errors via error options', async () => {
    const upstreamError = new Response(JSON.stringify({ error: 'boom' }), {
      status: 429,
      statusText: 'Too Many Requests',
    });
    upstreamError.headers.delete('content-type');

    const result = await createNodeResponse(
      async () => {
        throw upstreamError;
      },
      {
        error: {
          cacheControl: 'no-store',
          defaultContentType: 'application/json',
        },
      },
    );

    expect(result.status).toBe(429);
    expect(result.headers.get('content-type')).toBe('application/json');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toEqual({ error: 'boom' });
  });

  it('delegates to onNonResponseError for unexpected exceptions', async () => {
    const fallback = new Response('fallback', { status: 500 });

    const result = await createNodeResponse(
      async () => {
        throw new Error('unexpected');
      },
      {
        onNonResponseError: () => fallback,
      },
    );

    expect(result).toBe(fallback);
  });
});
