// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { stripEmptyUntypedBody } from './request-body';

const URL = 'https://localhost/api/auth/get-session';

const createPost = (body: BodyInit | null, headers?: HeadersInit) =>
  new Request(URL, { body, duplex: 'half', headers, method: 'POST' } as RequestInit);

const emptyStream = () => new ReadableStream({ start: (controller) => controller.close() });

describe('stripEmptyUntypedBody', () => {
  it('drops an empty body stream from a POST without a content type', async () => {
    const request = createPost(emptyStream(), { cookie: 'session=1', origin: 'https://localhost' });

    const result = await stripEmptyUntypedBody(request);

    expect(result.body).toBeNull();
    expect(result.method).toBe('POST');
    expect(result.url).toBe(URL);
    expect(result.headers.get('cookie')).toBe('session=1');
    expect(result.headers.get('origin')).toBe('https://localhost');
  });

  it('keeps requests that declare a content type', async () => {
    const request = createPost('{}', { 'content-type': 'application/json' });

    const result = await stripEmptyUntypedBody(request);

    expect(result).toBe(request);
    await expect(result.json()).resolves.toEqual({});
  });

  it('keeps an untyped request that carries data without consuming it', async () => {
    const request = createPost('payload');
    request.headers.delete('content-type');

    const result = await stripEmptyUntypedBody(request);

    expect(result).toBe(request);
    await expect(result.text()).resolves.toBe('payload');
  });

  it('keeps requests without a body stream', async () => {
    const request = createPost(null);

    expect(await stripEmptyUntypedBody(request)).toBe(request);
  });
});
