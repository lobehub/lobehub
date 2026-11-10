import { describe, expect, it } from 'vitest';

import {
  detectUnreadableServerResponse,
  findUnreadableServerResponseError,
  UnreadableServerResponseError,
} from './unreadableServerResponse';

const htmlPage = '<!doctype html><html><body>504 Gateway Timeout</body></html>';

describe('detectUnreadableServerResponse', () => {
  it('keeps the status and the most specific edge request id of an HTML page', async () => {
    const error = await detectUnreadableServerResponse(
      new Response(htmlPage, {
        headers: {
          'cf-ray': 'a4f726100b0cd438-SJC',
          'content-type': 'text/html; charset=utf-8',
          'x-vercel-id': 'sfo1::cle1::6gzdg-1792825689647-00c66abd3c56',
        },
        status: 504,
      }),
    );

    expect(error).toBeInstanceOf(UnreadableServerResponseError);
    expect(error).toMatchObject({
      requestId: 'sfo1::cle1::6gzdg-1792825689647-00c66abd3c56',
      status: 504,
    });
  });

  it('falls back to the Cloudflare Ray ID when the request never reached Vercel', async () => {
    const error = await detectUnreadableServerResponse(
      new Response(htmlPage, {
        headers: { 'cf-ray': 'a4f726100b0cd438-SJC', 'content-type': 'text/html' },
        status: 502,
      }),
    );

    expect(error).toMatchObject({ requestId: 'a4f726100b0cd438-SJC', status: 502 });
  });

  it('reports a proxy plain-text error without a request id', async () => {
    const error = await detectUnreadableServerResponse(
      new Response('upstream request timeout', {
        headers: { 'content-type': 'text/plain' },
        status: 504,
      }),
    );

    expect(error).toMatchObject({ requestId: undefined, status: 504 });
    expect(error?.message).toBe('Server returned a non-JSON response (HTTP 504)');
  });

  it('passes through a JSON response without reading its body', async () => {
    const response = new Response('{"result":{}}', {
      headers: { 'content-type': 'application/json' },
    });

    expect(await detectUnreadableServerResponse(response)).toBeUndefined();
    expect(response.bodyUsed).toBe(false);
  });

  it('passes through a JSON body served with a non-JSON content type', async () => {
    expect(
      await detectUnreadableServerResponse(
        new Response('{"result":{}}', { headers: { 'content-type': 'text/plain' } }),
      ),
    ).toBeUndefined();
  });
});

describe('findUnreadableServerResponseError', () => {
  const unreadable = new UnreadableServerResponseError({ status: 502 });

  it('finds the error directly or on a wrapping error cause', () => {
    expect(findUnreadableServerResponseError(unreadable)).toBe(unreadable);
    expect(findUnreadableServerResponseError(new Error('wrapped', { cause: unreadable }))).toBe(
      unreadable,
    );
  });

  it('ignores unrelated errors', () => {
    expect(findUnreadableServerResponseError(new Error('boom'))).toBeUndefined();
    expect(findUnreadableServerResponseError('boom')).toBeUndefined();
    expect(findUnreadableServerResponseError(undefined)).toBeUndefined();
  });
});
