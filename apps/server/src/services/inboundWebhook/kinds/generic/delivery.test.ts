import { describe, expect, it } from 'vitest';

import { parseBody, parseGenericDelivery, pickHeaders } from './delivery';

const request = (
  init: { body?: string; headers?: Record<string, string>; query?: string } = {},
) => ({
  body: init.body ?? '',
  headers: new Headers(init.headers),
  query: new URLSearchParams(init.query),
});

describe('parseBody', () => {
  it.each([
    ['JSON', '{"a":1}', 'application/json', { a: 1 }],
    ['vendor JSON', '[1,2]', 'application/vnd.api+json', [1, 2]],
    ['a form', 'a=1&tag=x&tag=y', 'application/x-www-form-urlencoded', { a: '1', tag: ['x', 'y'] }],
    // `curl -d '{...}'` labels JSON as a form.
    ['JSON sent as a form', '{"a":1}', 'application/x-www-form-urlencoded', { a: 1 }],
    ['JSON without a type', '{"a":1}', '', { a: 1 }],
    // `curl -d 'text'` labels plain text as a form too.
    [
      'text sent as a form',
      'Disk almost full on web-1',
      'application/x-www-form-urlencoded',
      'Disk almost full on web-1',
    ],
    ['plain text', 'disk full', 'text/plain', 'disk full'],
    ['text that only looks like JSON', '{not json', 'text/plain', '{not json'],
    ['an empty body', '   ', 'application/json', {}],
  ])('reads %s', (_, body, type, value) => {
    expect(parseBody(body, type)).toEqual({ ok: true, value });
  });

  it('rejects malformed JSON that says it is JSON, and file uploads', () => {
    expect(parseBody('{oops', 'application/json')).toMatchObject({ ok: false, status: 400 });
    expect(parseBody('--x', 'multipart/form-data; boundary=x')).toMatchObject({
      ok: false,
      status: 415,
    });
  });
});

describe('parseBody, many repeated form fields', () => {
  it('keeps every value of a field repeated as often as the body limit allows', () => {
    // About the most fields the 256 KB body limit lets through.
    const body = 'a=&'.repeat(80_000);
    const parsed = parseBody(body, 'application/x-www-form-urlencoded');
    expect(parsed).toMatchObject({ ok: true });
    expect((parsed as { value: { a: string[] } }).value.a).toHaveLength(80_000);
  });
});

describe('pickHeaders', () => {
  it('keeps content shape, sender and event headers, never credentials or infrastructure', () => {
    expect(
      pickHeaders(
        new Headers({
          'authorization': 'Bearer secret',
          'content-type': 'application/json',
          'cookie': 'a=b',
          'user-agent': 'GitHub-Hookshot',
          'x-api-key': 'secret',
          'x-forwarded-for': '1.2.3.4',
          'x-github-event': 'push',
          'x-hub-signature-256': 'sha256=abc',
          'x-real-ip': '1.2.3.4',
          'x-thread-key': 'ticket-1',
          'x-vercel-id': 'iad1',
        }),
      ),
    ).toEqual({
      'content-type': 'application/json',
      'user-agent': 'GitHub-Hookshot',
      'x-github-event': 'push',
    });
  });
});

describe('parseGenericDelivery', () => {
  it('uses the idempotency key as the delivery id and keeps the thread out of the query', () => {
    const { event } = parseGenericDelivery(
      request({
        body: '{"n":1}',
        headers: { 'idempotency-key': 'job-7' },
        query: 'thread=ticket-42&env=prod',
      }),
    );
    expect(event).toMatchObject({
      address: { threadKey: 'ticket-42' },
      data: { body: { n: 1 }, query: { env: 'prod' } },
      eventId: 'job-7',
      name: 'webhook',
    });
  });

  it('keeps prototype-named query and form keys as plain fields', () => {
    const { event } = parseGenericDelivery(
      request({
        body: '__proto__=a&__proto__=b&constructor=c',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        query: '__proto__=x&__proto__=y&prototype=z',
      }),
    );
    const data = event!.data as { body: object; query: object };
    // Compared as JSON: in an object literal, `__proto__:` would set the prototype instead.
    expect(JSON.stringify(data.body)).toBe('{"__proto__":["a","b"],"constructor":"c"}');
    expect(JSON.stringify(data.query)).toBe('{"__proto__":["x","y"],"prototype":"z"}');
    expect(Object.getPrototypeOf(data.query)).toBeNull();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('takes the thread from X-Thread-Key, and gives an unkeyed call a fresh id', () => {
    const first = parseGenericDelivery(request({ headers: { 'x-thread-key': ' t-1 ' } })).event!;
    const second = parseGenericDelivery(request()).event!;
    expect(first.address).toEqual({ threadKey: 't-1' });
    expect(second.address).toBeUndefined();
    expect(first.eventId).not.toBe(second.eventId);
  });

  it('hashes an idempotency key too long to store as is', () => {
    const { event } = parseGenericDelivery(
      request({ headers: { 'idempotency-key': 'k'.repeat(300) } }),
    );
    expect(event!.eventId).toMatch(/^sha256:[\da-f]{64}$/);
  });

  it('marks a test delivery', () => {
    expect(parseGenericDelivery({ ...request(), test: true }).event!.extra).toEqual({ test: true });
  });
});
