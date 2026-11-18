// @vitest-environment node
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { toPlainRequest } from './plainRequest';

const proxiedLikeNextRouteHandler = (request: NextRequest) =>
  new Proxy(request, { get: (target, prop) => Reflect.get(target, prop, target) });

const emptyStream = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });

const app = new Hono()
  .use('*', bodyLimit({ maxSize: 1024 }))
  .delete('/reviews/:id', (c) => c.body(null, 204))
  .post('/echo', async (c) => c.text(await c.req.text()));

describe('toPlainRequest', () => {
  it('lets body-limit rebuild a proxied request that has a body stream and no content-length', async () => {
    const request = proxiedLikeNextRouteHandler(
      new NextRequest('http://localhost/reviews/1', {
        body: emptyStream(),
        duplex: 'half',
        method: 'DELETE',
      }),
    );

    const response = await app.fetch(toPlainRequest(request));

    expect(response.status).toBe(204);
  });

  it('keeps method, headers and a streamed body', async () => {
    const request = proxiedLikeNextRouteHandler(
      new NextRequest('http://localhost/echo', {
        body: new Blob(['hello']).stream(),
        duplex: 'half',
        headers: { 'x-test': '1' },
        method: 'POST',
      }),
    );

    const plain = toPlainRequest(request);

    expect(plain.headers.get('x-test')).toBe('1');
    expect(plain.method).toBe('POST');
    expect(await (await app.fetch(plain)).text()).toBe('hello');
  });

  it('passes bodyless GET through', async () => {
    const request = proxiedLikeNextRouteHandler(new NextRequest('http://localhost/reviews/1'));

    const plain = toPlainRequest(request);

    expect(plain.method).toBe('GET');
    expect(plain.body).toBeNull();
    expect(plain.url).toBe('http://localhost/reviews/1');
  });
});
