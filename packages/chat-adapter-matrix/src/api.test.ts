import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrixApiClient, parseMxc } from './api';

const HS = 'https://matrix.example.org';
const TOKEN = 'syt_test_token';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

beforeEach(() => {
  fetchSpy.mockReset();
});

describe('parseMxc', () => {
  it('splits server and media id', () => {
    expect(parseMxc('mxc://matrix.org/aBcD1234')).toEqual({
      mediaId: 'aBcD1234',
      serverName: 'matrix.org',
    });
  });

  it('rejects non-mxc input', () => {
    expect(parseMxc('https://x/y')).toBeUndefined();
    expect(parseMxc('mxc://noslash')).toBeUndefined();
  });
});

describe('MatrixApiClient.login', () => {
  it('posts m.login.password with a bare localpart and returns a token', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ access_token: 'tok', device_id: 'DEV', user_id: '@bot:example.org' }),
    );

    const res = await MatrixApiClient.login({
      homeserverUrl: HS,
      password: 'pw',
      user: '@bot:example.org',
    });

    expect(res.access_token).toBe('tok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`${HS}/_matrix/client/v3/login`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.type).toBe('m.login.password');
    expect(body.identifier).toEqual({ type: 'm.id.user', user: 'bot' });
    expect(body.password).toBe('pw');
  });

  it('throws the Matrix error envelope on failure', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ errcode: 'M_FORBIDDEN', error: 'Invalid password' }, 403),
    );

    await expect(
      MatrixApiClient.login({ homeserverUrl: HS, password: 'bad', user: 'bot' }),
    ).rejects.toThrow('M_FORBIDDEN: Invalid password');
  });
});

describe('MatrixApiClient.whoami', () => {
  it('validates a token and returns the user id', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ user_id: '@bot:example.org' }));
    const api = new MatrixApiClient({ accessToken: TOKEN, homeserverUrl: `${HS}/` });
    const res = await api.whoami();
    expect(res.user_id).toBe('@bot:example.org');
    const [url, init] = fetchSpy.mock.calls[0];
    // Trailing slash on homeserverUrl is normalized away.
    expect(String(url)).toBe(`${HS}/_matrix/client/v3/account/whoami`);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });
});

describe('MatrixApiClient.sendMessage', () => {
  it('PUTs to the send endpoint with a transaction id', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ event_id: '$evt1' }));
    const api = new MatrixApiClient({ accessToken: TOKEN, homeserverUrl: HS });
    const res = await api.sendMessage('!room:example.org', {
      body: 'hi',
      msgtype: 'm.notice',
    });
    expect(res.event_id).toBe('$evt1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).method).toBe('PUT');
    expect(String(url)).toMatch(
      /\/_matrix\/client\/v3\/rooms\/!room%3Aexample\.org\/send\/m\.room\.message\/lobehub_/,
    );
  });
});

describe('MatrixApiClient.editMessage', () => {
  it('sends an m.replace relation with m.new_content', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ event_id: '$evt2' }));
    const api = new MatrixApiClient({ accessToken: TOKEN, homeserverUrl: HS });
    await api.editMessage('!room:example.org', '$orig', { body: 'new', msgtype: 'm.notice' });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.body).toBe('* new');
    expect(body['m.relates_to']).toEqual({ event_id: '$orig', rel_type: 'm.replace' });
    expect(body['m.new_content']).toMatchObject({ body: 'new', msgtype: 'm.notice' });
  });
});

describe('MatrixApiClient.downloadMedia', () => {
  it('falls back to the legacy endpoint when authed media 404s', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(Buffer.from([1, 2, 3]), { status: 200 }));
    const api = new MatrixApiClient({ accessToken: TOKEN, homeserverUrl: HS });
    const buf = await api.downloadMedia('mxc://example.org/abc');
    expect(buf).toEqual(Buffer.from([1, 2, 3]));
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/_matrix/client/v1/media/download/');
    expect(String(fetchSpy.mock.calls[1][0])).toContain('/_matrix/media/v3/download/');
  });
});
