import { describe, expect, it } from 'vitest';

import { createNodeResponse, ensureNodeResponse, isResponseLike } from '../response';

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

describe('isResponseLike', () => {
  it('should return true for valid Response object', () => {
    const response = new Response('test', { status: 200 });
    expect(isResponseLike(response)).toBe(true);
  });

  it('should return true for object with Response-like structure', () => {
    const responseLike = {
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: new Headers({ 'content-type': 'text/plain' }),
      status: 200,
      statusText: 'OK',
    };
    expect(isResponseLike(responseLike)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isResponseLike(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isResponseLike(undefined)).toBe(false);
  });

  it('should return false for primitive types', () => {
    expect(isResponseLike('string')).toBe(false);
    expect(isResponseLike(123)).toBe(false);
    expect(isResponseLike(true)).toBe(false);
  });

  it('should return false for empty object', () => {
    expect(isResponseLike({})).toBe(false);
  });

  it('should return false for object missing arrayBuffer method', () => {
    const notResponse = {
      headers: new Headers(),
      status: 200,
      statusText: 'OK',
    };
    expect(isResponseLike(notResponse)).toBe(false);
  });

  it('should return false for object missing headers', () => {
    const notResponse = {
      arrayBuffer: async () => new ArrayBuffer(0),
      status: 200,
      statusText: 'OK',
    };
    expect(isResponseLike(notResponse)).toBe(false);
  });

  it('should return false for object with invalid headers (no get method)', () => {
    const notResponse = {
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: { 'content-type': 'text/plain' },
      status: 200,
      statusText: 'OK',
    };
    expect(isResponseLike(notResponse)).toBe(false);
  });

  it('should return false for object missing status', () => {
    const notResponse = {
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: new Headers(),
      statusText: 'OK',
    };
    expect(isResponseLike(notResponse)).toBe(false);
  });

  it('should return false for object with non-number status', () => {
    const notResponse = {
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: new Headers(),
      status: '200',
      statusText: 'OK',
    };
    expect(isResponseLike(notResponse)).toBe(false);
  });

  it('should return false for object missing statusText', () => {
    const notResponse = {
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: new Headers(),
      status: 200,
    };
    expect(isResponseLike(notResponse)).toBe(false);
  });

  it('should return false for object with non-string statusText', () => {
    const notResponse = {
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: new Headers(),
      status: 200,
      statusText: 200,
    };
    expect(isResponseLike(notResponse)).toBe(false);
  });

  it('should return false for array', () => {
    expect(isResponseLike([])).toBe(false);
  });

  it('should return false for function', () => {
    expect(isResponseLike(() => {})).toBe(false);
  });
});

describe('ensureNodeResponse', () => {
  it('should create new Response from source Response', async () => {
    const source = new Response('test content', {
      headers: { 'x-custom': 'value' },
      status: 200,
      statusText: 'OK',
    });

    const result = await ensureNodeResponse(source);

    expect(result).toBeInstanceOf(Response);
    expect(await result.text()).toBe('test content');
    expect(result.status).toBe(200);
    expect(result.statusText).toBe('OK');
    expect(result.headers.get('x-custom')).toBe('value');
  });

  it('should add default content-type when missing', async () => {
    const source = new Response('test');
    source.headers.delete('content-type');

    const result = await ensureNodeResponse(source, {
      defaultContentType: 'application/json',
    });

    expect(result.headers.get('content-type')).toBe('application/json');
  });

  it('should not override existing content-type', async () => {
    const source = new Response('test', {
      headers: { 'content-type': 'text/plain' },
    });

    const result = await ensureNodeResponse(source, {
      defaultContentType: 'application/json',
    });

    expect(result.headers.get('content-type')).toBe('text/plain');
  });

  it('should set cache-control header when specified', async () => {
    const source = new Response('test');

    const result = await ensureNodeResponse(source, {
      cacheControl: 'no-store, must-revalidate',
    });

    expect(result.headers.get('cache-control')).toBe('no-store, must-revalidate');
  });

  it('should override existing cache-control header', async () => {
    const source = new Response('test', {
      headers: { 'cache-control': 'public, max-age=3600' },
    });

    const result = await ensureNodeResponse(source, {
      cacheControl: 'no-cache',
    });

    expect(result.headers.get('cache-control')).toBe('no-cache');
  });

  it('should use stream body when forceBuffering is false and body exists', async () => {
    const source = new Response('stream content');

    const result = await ensureNodeResponse(source, {
      forceBuffering: false,
    });

    expect(result.body).toBeTruthy();
    expect(await result.text()).toBe('stream content');
  });

  it('should buffer body when forceBuffering is true', async () => {
    const source = new Response('buffered content');

    const result = await ensureNodeResponse(source, {
      forceBuffering: true,
    });

    expect(await result.text()).toBe('buffered content');
  });

  it('should handle Response with no body', async () => {
    const source = new Response(null, { status: 204 });

    const result = await ensureNodeResponse(source);

    expect(result.status).toBe(204);
    expect(await result.text()).toBe('');
  });

  it('should preserve all headers from source', async () => {
    const source = new Response('test', {
      headers: {
        'content-type': 'text/html',
        'x-custom-1': 'value1',
        'x-custom-2': 'value2',
        'authorization': 'Bearer token',
      },
    });

    const result = await ensureNodeResponse(source);

    expect(result.headers.get('content-type')).toBe('text/html');
    expect(result.headers.get('x-custom-1')).toBe('value1');
    expect(result.headers.get('x-custom-2')).toBe('value2');
    expect(result.headers.get('authorization')).toBe('Bearer token');
  });

  it('should handle error status codes', async () => {
    const source = new Response('Not Found', {
      status: 404,
      statusText: 'Not Found',
    });

    const result = await ensureNodeResponse(source);

    expect(result.status).toBe(404);
    expect(result.statusText).toBe('Not Found');
  });

  it('should apply both defaultContentType and cacheControl', async () => {
    const source = new Response('test');
    source.headers.delete('content-type');

    const result = await ensureNodeResponse(source, {
      defaultContentType: 'application/json',
      cacheControl: 'no-store',
    });

    expect(result.headers.get('content-type')).toBe('application/json');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });

  it('should handle JSON response body', async () => {
    const jsonData = { message: 'success', code: 200 };
    const source = new Response(JSON.stringify(jsonData), {
      headers: { 'content-type': 'application/json' },
    });

    const result = await ensureNodeResponse(source);

    expect(await result.json()).toEqual(jsonData);
  });

  it('should handle binary data', async () => {
    const binaryData = new Uint8Array([1, 2, 3, 4, 5]);
    const source = new Response(binaryData, {
      headers: { 'content-type': 'application/octet-stream' },
    });

    const result = await ensureNodeResponse(source);

    const arrayBuffer = await result.arrayBuffer();
    const resultArray = new Uint8Array(arrayBuffer);
    expect(resultArray).toEqual(binaryData);
  });

  it('should handle empty options object', async () => {
    const source = new Response('test', { status: 200 });

    const result = await ensureNodeResponse(source, {});

    expect(result.status).toBe(200);
    expect(await result.text()).toBe('test');
  });

  it('should handle redirect status codes', async () => {
    const source = new Response(null, {
      status: 302,
      statusText: 'Found',
      headers: { location: 'https://example.com' },
    });

    const result = await ensureNodeResponse(source);

    expect(result.status).toBe(302);
    expect(result.statusText).toBe('Found');
    expect(result.headers.get('location')).toBe('https://example.com');
  });
});
