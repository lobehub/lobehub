// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as NativeHandoffModule from './nativeHandoff';

const { issue, listTargets } = vi.hoisted(() => ({ issue: vi.fn(), listTargets: vi.fn() }));

vi.mock('@lobechat/database', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/user', () => ({ UserModel: { findById: vi.fn() } }));
vi.mock('@/server/services/redis', () => ({
  redisService: { oidcNativeHandoff: { countRequest: vi.fn() } },
}));
vi.mock('./oidcProvider', () => ({ getOIDCProvider: vi.fn(async () => ({})) }));
vi.mock('./nativeHandoff', async (importOriginal) => {
  const actual = await importOriginal<typeof NativeHandoffModule>();
  return {
    ...actual,
    NativeHandoffService: vi.fn(function () {
      return { issue, listTargets };
    }),
  };
});

const { NativeHandoffError } = await import('./nativeHandoff');
const { handleNativeHandoffIssue, handleNativeHandoffTargets } =
  await import('./nativeHandoffHttp');

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://localhost:3010/oidc/handoff/native', {
    body,
    headers: { 'content-type': 'application/json', ...headers },
    method: 'POST',
  });

beforeEach(() => {
  issue.mockReset();
  listTargets.mockReset();
});

describe('native handoff HTTP adapter', () => {
  it('passes the Oidc-Auth token, the body and the audit context to the service', async () => {
    issue.mockResolvedValue({ code: 'c', expires_in: 60, iss: 'http://localhost:3010/oidc' });

    const response = await handleNativeHandoffIssue(
      post('{"client_id":"native-app"}', {
        'oidc-auth': 'desktop-token',
        'user-agent': 'LobeHub-Desktop',
        'x-forwarded-for': '203.0.113.9, 10.0.0.1',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      code: 'c',
      expires_in: 60,
      iss: 'http://localhost:3010/oidc',
    });
    expect(issue).toHaveBeenCalledWith(
      'desktop-token',
      { client_id: 'native-app' },
      { ip: '203.0.113.9', userAgent: 'LobeHub-Desktop' },
    );
  });

  it('accepts a bearer token too', async () => {
    listTargets.mockResolvedValue({ targets: [] });

    await handleNativeHandoffTargets(
      new Request('http://localhost:3010/oidc/handoff/native', {
        headers: { authorization: 'Bearer abc' },
      }),
    );

    expect(listTargets).toHaveBeenCalledWith('abc');
  });

  it.each([
    ['a non-JSON content type', post('{}', { 'content-type': 'text/plain' })],
    ['malformed JSON', post('{')],
    ['a JSON array', post('[]')],
    ['an oversized body', post(JSON.stringify({ pad: 'x'.repeat(5000) }))],
  ])('rejects %s with invalid_request', async (_label, request) => {
    const response = await handleNativeHandoffIssue(request);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_request');
    expect(issue).not.toHaveBeenCalled();
  });

  it('refuses a declared oversized body without reading it', async () => {
    const pull = vi.fn();
    const request = new Request('http://localhost:3010/oidc/handoff/native', {
      body: new ReadableStream({ pull }, { highWaterMark: 0 }),
      // @ts-expect-error -- Node's fetch needs duplex for a streamed body
      duplex: 'half',
      headers: { 'content-length': '1048576', 'content-type': 'application/json' },
      method: 'POST',
    });

    const response = await handleNativeHandoffIssue(request);

    expect(response.status).toBe(400);
    expect((await response.json()).error_description).toBe('body is too large');
    expect(pull).not.toHaveBeenCalled();
  });

  it('stops reading a chunked body once it passes the cap', async () => {
    let served = 0;
    const request = new Request('http://localhost:3010/oidc/handoff/native', {
      body: new ReadableStream({
        pull(controller) {
          served += 1;
          controller.enqueue(new Uint8Array(1024));
        },
      }),
      // @ts-expect-error -- Node's fetch needs duplex for a streamed body
      duplex: 'half',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    const response = await handleNativeHandoffIssue(request);

    expect(response.status).toBe(400);
    expect((await response.json()).error_description).toBe('body is too large');
    // 4 KiB cap: the fifth 1 KiB chunk crosses it, and nothing is pulled far beyond.
    expect(served).toBeLessThanOrEqual(6);
    expect(issue).not.toHaveBeenCalled();
  });

  it('maps service errors to their status and error code', async () => {
    issue.mockRejectedValue(new NativeHandoffError('issuer_mismatch', 'other issuer'));

    const response = await handleNativeHandoffIssue(post('{}'));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'issuer_mismatch',
      error_description: 'other issuer',
    });
  });

  it('hides unexpected failures behind server_error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    issue.mockRejectedValue(new Error('db down'));

    const response = await handleNativeHandoffIssue(post('{}'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'server_error',
      error_description: 'native handoff failed',
    });
  });
});
