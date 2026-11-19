// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { getSsoTicketConfig } from './config';
import { requestTicket } from './requestTicket';

const config = getSsoTicketConfig({
  AUTH_SSO_TICKET_CLIENT_ID: 'lobehub',
  AUTH_SSO_TICKET_CLIENT_SECRET: 'secret-value',
  AUTH_SSO_TICKET_CREATE_URL: 'https://sso.example.com/auth/sso/ticket/create',
  AUTH_SSO_TICKET_ENABLED: '1',
  AUTH_SSO_TICKET_EXCHANGE_URL: 'https://sso.example.com/auth/sso/ticket/exchange',
  AUTH_SSO_TICKET_LOGIN_DOMAIN: 'DEV',
  AUTH_SSO_TICKET_REDIRECT_URI: 'https://lobehub.example.com/api/auth/sso-ticket/callback',
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const failingCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; message?: string };
  }

  throw new Error('expected requestTicket to reject');
};

describe('requestTicket', () => {
  it('calls ticket/create with the bearer token and returns the ticket', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 0, data: { ticket: 'ST-created', clientId: 'lobehub' } }),
    );

    const ticket = await requestTicket('platform-token', config, { fetchImpl });

    expect(ticket).toBe('ST-created');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://sso.example.com/auth/sso/ticket/create');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer platform-token');
    expect(JSON.parse(String(init.body))).toEqual({
      clientId: 'lobehub',
      loginDomain: 'DEV',
      redirectUri: 'https://lobehub.example.com/api/auth/sso-ticket/callback',
    });
  });

  it('falls back to parsing the ticket out of redirectUrl', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: { redirectUrl: 'https://lobehub.example.com/cb?ticket=ST-from-url&x=1' },
      }),
    );

    expect(await requestTicket('platform-token', config, { fetchImpl })).toBe('ST-from-url');
  });

  it('rejects a 401 as SSO_TOKEN_INVALID', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));

    expect((await failingCode(requestTicket('t', config, { fetchImpl }))).code).toBe(
      'SSO_TOKEN_INVALID',
    );
  });

  it('rejects a 403 as SSO_TOKEN_INVALID', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 403));

    expect((await failingCode(requestTicket('t', config, { fetchImpl }))).code).toBe(
      'SSO_TOKEN_INVALID',
    );
  });

  it('maps server failures to SSO_TICKET_CREATE_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));

    expect((await failingCode(requestTicket('t', config, { fetchImpl }))).code).toBe(
      'SSO_TICKET_CREATE_UNAVAILABLE',
    );
  });

  it('maps network failures and timeouts to SSO_TICKET_CREATE_UNAVAILABLE', async () => {
    const network = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const aborted = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });

    expect((await failingCode(requestTicket('t', config, { fetchImpl: network }))).code).toBe(
      'SSO_TICKET_CREATE_UNAVAILABLE',
    );
    expect((await failingCode(requestTicket('t', config, { fetchImpl: aborted }))).code).toBe(
      'SSO_TICKET_CREATE_UNAVAILABLE',
    );
  });

  it.each(['INVALID_TOKEN', 'SSO_TOKEN_INVALID', 'UNAUTHORIZED'])(
    'maps platform business code %s to SSO_TOKEN_INVALID',
    async (platformCode) => {
      const fetchImpl = vi.fn(async () => jsonResponse({ code: platformCode, msg: 'bad token' }));

      expect((await failingCode(requestTicket('t', config, { fetchImpl }))).code).toBe(
        'SSO_TOKEN_INVALID',
      );
    },
  );

  it('maps unknown business codes to SSO_TICKET_CREATE_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 'SOMETHING_ELSE' }));

    expect((await failingCode(requestTicket('t', config, { fetchImpl }))).code).toBe(
      'SSO_TICKET_CREATE_UNAVAILABLE',
    );
  });

  it('rejects when the ticket is absent from the response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 0, data: {} }));

    expect((await failingCode(requestTicket('t', config, { fetchImpl }))).code).toBe(
      'SSO_TICKET_CREATE_UNAVAILABLE',
    );
  });

  it('rejects when the returned clientId or loginDomain does not match', async () => {
    const clientMismatch = vi.fn(async () =>
      jsonResponse({ code: 0, data: { clientId: 'other', ticket: 'ST-1' } }),
    );
    const domainMismatch = vi.fn(async () =>
      jsonResponse({ code: 0, data: { loginDomain: 'PROD', ticket: 'ST-1' } }),
    );

    expect((await failingCode(requestTicket('t', config, { fetchImpl: clientMismatch }))).code).toBe(
      'SSO_CLIENT_MISMATCH',
    );
    expect((await failingCode(requestTicket('t', config, { fetchImpl: domainMismatch }))).code).toBe(
      'SSO_CLIENT_MISMATCH',
    );
  });

  it('rejects before calling fetch when the token flow is not configured', async () => {
    const unconfigured = getSsoTicketConfig({
      AUTH_SSO_TICKET_CLIENT_ID: 'lobehub',
      AUTH_SSO_TICKET_CLIENT_SECRET: 'secret',
      AUTH_SSO_TICKET_ENABLED: '1',
      AUTH_SSO_TICKET_EXCHANGE_URL: 'https://sso.example.com/exchange',
    });
    const fetchImpl = vi.fn();

    expect((await failingCode(requestTicket('t', unconfigured, { fetchImpl }))).code).toBe(
      'SSO_CLIENT_AUTH_INVALID',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never includes the token in the error message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 'INVALID_TOKEN' }));
    const token = 'TOKEN-super-secret-value';

    const error = await failingCode(requestTicket(token, config, { fetchImpl }));

    expect(error.message).toBe('SSO_TOKEN_INVALID');
    expect(error.message).not.toContain(token);
  });
});
