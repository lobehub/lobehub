import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildInstallUrl, exchangeCode, refreshToken, verifySignature } from './slackOAuth';

const SIGNING_SECRET = 'test-signing-secret';

const sign = (body: string, timestamp: string, secret = SIGNING_SECRET): string => {
  const digest = createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
  return `v0=${digest}`;
};

describe('buildInstallUrl', () => {
  it('builds the canonical Slack authorize URL with required params', () => {
    const url = buildInstallUrl({
      clientId: '12345.6789',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['chat:write', 'im:history'],
      state: 'nonce-abc',
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('12345.6789');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/callback');
    expect(parsed.searchParams.get('state')).toBe('nonce-abc');
    expect(parsed.searchParams.get('scope')).toBe('chat:write,im:history');
    expect(parsed.searchParams.get('user_scope')).toBeNull();
  });

  it('omits user_scope when not provided or empty', () => {
    const url = buildInstallUrl({
      clientId: 'cid',
      redirectUri: 'https://e.com/cb',
      scopes: ['chat:write'],
      state: 's',
      userScopes: [],
    });
    expect(new URL(url).searchParams.get('user_scope')).toBeNull();
  });

  it('joins user_scope with commas when provided', () => {
    const url = buildInstallUrl({
      clientId: 'cid',
      redirectUri: 'https://e.com/cb',
      scopes: ['chat:write'],
      state: 's',
      userScopes: ['identity.basic', 'identity.email'],
    });
    expect(new URL(url).searchParams.get('user_scope')).toBe('identity.basic,identity.email');
  });
});

describe('exchangeCode', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts form-encoded credentials and returns the parsed response', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'xoxb-real',
          app_id: 'A123',
          bot_user_id: 'U_BOT',
          is_enterprise_install: false,
          ok: true,
          team: { id: 'T_ACME', name: 'Acme' },
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    );

    const result = await exchangeCode({
      clientId: 'cid',
      clientSecret: 'csecret',
      code: 'the-code',
      redirectUri: 'https://e.com/cb',
    });

    expect(result.access_token).toBe('xoxb-real');
    expect(result.team?.id).toBe('T_ACME');

    const [, init] = fetchSpy.mock.calls[0];
    const body = init?.body as URLSearchParams;
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('csecret');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('redirect_uri')).toBe('https://e.com/cb');
  });

  it('throws when the HTTP layer fails', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('upstream', { status: 502 }));

    await expect(
      exchangeCode({ clientId: 'a', clientSecret: 'b', code: 'c', redirectUri: 'd' }),
    ).rejects.toThrow(/HTTP 502/);
  });

  it('throws when Slack reports a logical error (ok: false)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_code', ok: false }), { status: 200 }),
    );

    await expect(
      exchangeCode({ clientId: 'a', clientSecret: 'b', code: 'c', redirectUri: 'd' }),
    ).rejects.toThrow(/invalid_code/);
  });
});

describe('refreshToken', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends grant_type=refresh_token and returns the rotated pair', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'xoxe.xoxb-new',
          expires_in: 43_200,
          ok: true,
          refresh_token: 'xoxe-1-new',
        }),
        { status: 200 },
      ),
    );

    const result = await refreshToken({
      clientId: 'cid',
      clientSecret: 'csecret',
      refreshToken: 'xoxe-1-old',
    });

    expect(result.access_token).toBe('xoxe.xoxb-new');
    expect(result.refresh_token).toBe('xoxe-1-new');
    expect(result.expires_in).toBe(43_200);

    const body = fetchSpy.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('xoxe-1-old');
  });
});

describe('verifySignature', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;
  const fixedNowMs = 1_700_000_000_000;
  const fixedTs = Math.floor(fixedNowMs / 1000).toString();

  beforeEach(() => {
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNowMs);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('accepts a correctly-signed request within the tolerance window', () => {
    const body = '{"type":"event_callback"}';
    const ok = verifySignature({
      rawBody: body,
      signature: sign(body, fixedTs),
      signingSecret: SIGNING_SECRET,
      timestamp: fixedTs,
    });
    expect(ok).toBe(true);
  });

  it('rejects when the body is tampered', () => {
    const body = '{"type":"event_callback"}';
    const ok = verifySignature({
      rawBody: '{"type":"event_callback","tampered":true}',
      signature: sign(body, fixedTs),
      signingSecret: SIGNING_SECRET,
      timestamp: fixedTs,
    });
    expect(ok).toBe(false);
  });

  it('rejects when the signing secret differs', () => {
    const body = '{}';
    const ok = verifySignature({
      rawBody: body,
      signature: sign(body, fixedTs, 'other-secret'),
      signingSecret: SIGNING_SECRET,
      timestamp: fixedTs,
    });
    expect(ok).toBe(false);
  });

  it('rejects when the timestamp is older than the tolerance window', () => {
    const body = '{}';
    const oldTs = (Math.floor(fixedNowMs / 1000) - 600).toString();
    const ok = verifySignature({
      rawBody: body,
      signature: sign(body, oldTs),
      signingSecret: SIGNING_SECRET,
      timestamp: oldTs,
    });
    expect(ok).toBe(false);
  });

  it('rejects when the timestamp is in the far future', () => {
    const body = '{}';
    const futureTs = (Math.floor(fixedNowMs / 1000) + 600).toString();
    const ok = verifySignature({
      rawBody: body,
      signature: sign(body, futureTs),
      signingSecret: SIGNING_SECRET,
      timestamp: futureTs,
    });
    expect(ok).toBe(false);
  });

  it('rejects when the timestamp is non-numeric', () => {
    const ok = verifySignature({
      rawBody: 'x',
      signature: 'v0=anything',
      signingSecret: SIGNING_SECRET,
      timestamp: 'not-a-number',
    });
    expect(ok).toBe(false);
  });

  it('honours a custom tolerance', () => {
    const body = '{}';
    const ts = (Math.floor(fixedNowMs / 1000) - 30).toString();
    const sig = sign(body, ts);

    expect(
      verifySignature({
        rawBody: body,
        signature: sig,
        signingSecret: SIGNING_SECRET,
        timestamp: ts,
        toleranceSeconds: 10,
      }),
    ).toBe(false);

    expect(
      verifySignature({
        rawBody: body,
        signature: sig,
        signingSecret: SIGNING_SECRET,
        timestamp: ts,
        toleranceSeconds: 60,
      }),
    ).toBe(true);
  });
});
