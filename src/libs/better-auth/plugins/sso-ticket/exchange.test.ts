// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { getSsoTicketConfig } from './config';
import { exchangeTicket, redactTicket } from './exchange';

const config = getSsoTicketConfig({
  AUTH_SSO_TICKET_CLIENT_ID: 'lobehub',
  AUTH_SSO_TICKET_CLIENT_SECRET: 'secret-value',
  AUTH_SSO_TICKET_ENABLED: '1',
  AUTH_SSO_TICKET_EXCHANGE_URL: 'https://sso.example.com/auth/sso/ticket/exchange',
  AUTH_SSO_TICKET_LOGIN_DOMAIN: 'DEV',
});

const successBody = {
  code: 0,
  data: {
    clientId: 'lobehub',
    currentTenantId: 'tenant-meta',
    devOrgId: 'org-001',
    devOrgName: '研发中心',
    loginDomain: 'DEV',
    realName: '张三',
    roleCodes: ['developer'],
    userCode: 'A123456',
    userId: 'dev-user-001',
  },
  msg: 'success',
};

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

  throw new Error('expected exchangeTicket to reject');
};

describe('exchangeTicket', () => {
  it('exchanges a ticket and returns the mapped profile', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successBody));

    const profile = await exchangeTicket('ST-1234', config, { fetchImpl });

    expect(profile).toEqual({
      currentTenantId: 'tenant-meta',
      devOrgId: 'org-001',
      devOrgName: '研发中心',
      loginDomain: 'DEV',
      realName: '张三',
      roleCodes: ['developer'],
      userCode: 'A123456',
      userId: 'dev-user-001',
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get('ticket')).toBe('ST-1234');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('lobehub:secret-value').toString('base64')}`,
    );
  });

  it('maps HTTP 401 to SSO_CLIENT_AUTH_INVALID', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));

    const error = await failingCode(exchangeTicket('ST-1', config, { fetchImpl }));

    expect(error.code).toBe('SSO_CLIENT_AUTH_INVALID');
  });

  it('maps HTTP 403 to SSO_CLIENT_AUTH_INVALID', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 403));

    expect((await failingCode(exchangeTicket('ST-1', config, { fetchImpl }))).code).toBe(
      'SSO_CLIENT_AUTH_INVALID',
    );
  });

  it('maps HTTP 500 to SSO_EXCHANGE_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));

    expect((await failingCode(exchangeTicket('ST-1', config, { fetchImpl }))).code).toBe(
      'SSO_EXCHANGE_UNAVAILABLE',
    );
  });

  it('maps a non JSON body to SSO_EXCHANGE_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>oops</html>', { status: 200 }));

    expect((await failingCode(exchangeTicket('ST-1', config, { fetchImpl }))).code).toBe(
      'SSO_EXCHANGE_UNAVAILABLE',
    );
  });

  it('maps a network failure to SSO_EXCHANGE_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    expect((await failingCode(exchangeTicket('ST-1', config, { fetchImpl }))).code).toBe(
      'SSO_EXCHANGE_UNAVAILABLE',
    );
  });

  it('maps an aborted request (timeout) to SSO_EXCHANGE_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });

    expect((await failingCode(exchangeTicket('ST-1', config, { fetchImpl }))).code).toBe(
      'SSO_EXCHANGE_UNAVAILABLE',
    );
  });

  it.each([
    ['SSO_TICKET_INVALID', 'SSO_TICKET_INVALID'],
    ['SSO_CLIENT_MISMATCH', 'SSO_CLIENT_MISMATCH'],
    ['SSO_TICKET_USERINFO_INVALID', 'SSO_TICKET_USERINFO_INVALID'],
  ])('maps platform business code %s to %s', async (platformCode, expected) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: platformCode, msg: 'failed' }));

    expect((await failingCode(exchangeTicket('ST-1', config, { fetchImpl }))).code).toBe(expected);
  });

  it('falls back to SSO_TICKET_INVALID for unknown business codes', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 'SOMETHING_ELSE' }));

    expect((await failingCode(exchangeTicket('ST-1', config, { fetchImpl }))).code).toBe(
      'SSO_TICKET_INVALID',
    );
  });

  it('rejects when the returned clientId does not match', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...successBody, data: { ...successBody.data, clientId: 'other' } }),
    );

    expect((await failingCode(exchangeTicket('ST-1', config, { fetchImpl }))).code).toBe(
      'SSO_CLIENT_MISMATCH',
    );
  });

  it('rejects when the returned loginDomain does not match', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...successBody, data: { ...successBody.data, loginDomain: 'PROD' } }),
    );

    expect((await failingCode(exchangeTicket('ST-1', config, { fetchImpl }))).code).toBe(
      'SSO_CLIENT_MISMATCH',
    );
  });

  it.each(['userId', 'userCode', 'realName'])(
    'rejects when %s is missing from the profile',
    async (field) => {
      const data: Record<string, unknown> = { ...successBody.data };
      delete data[field];

      const fetchImpl = vi.fn(async () => jsonResponse({ ...successBody, data }));

      expect((await failingCode(exchangeTicket('ST-1', config, { fetchImpl }))).code).toBe(
        'SSO_TICKET_USERINFO_INVALID',
      );
    },
  );

  it('never puts the full ticket or the client secret in the error message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 'SSO_TICKET_INVALID' }));
    const ticket = 'ST-super-secret-ticket-value';

    const error = await failingCode(exchangeTicket(ticket, config, { fetchImpl }));

    expect(error.message).toBe('SSO_TICKET_INVALID');
    expect(error.message).not.toContain(ticket);
    expect(error.message).not.toContain('secret-value');
  });

  it('rejects when the client is not configured', async () => {
    const unconfigured = getSsoTicketConfig({});
    const fetchImpl = vi.fn();

    expect((await failingCode(exchangeTicket('ST-1', unconfigured, { fetchImpl }))).code).toBe(
      'SSO_CLIENT_AUTH_INVALID',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects when the exchange URL is invalid', async () => {
    const badConfig = getSsoTicketConfig({
      ...process.env,
      AUTH_SSO_TICKET_CLIENT_ID: 'lobehub',
      AUTH_SSO_TICKET_CLIENT_SECRET: 'secret-value',
      AUTH_SSO_TICKET_ENABLED: '1',
      AUTH_SSO_TICKET_EXCHANGE_URL: 'not-a-url',
    });
    const fetchImpl = vi.fn();

    expect((await failingCode(exchangeTicket('ST-1', badConfig, { fetchImpl }))).code).toBe(
      'SSO_EXCHANGE_UNAVAILABLE',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('redactTicket', () => {
  it('keeps only the first four characters and the length', () => {
    const redacted = redactTicket('ST-1234567890');

    expect(redacted).toBe('ST-1***(13)');
    expect(redacted).not.toContain('234567890');
  });

  it('handles empty tickets', () => {
    expect(redactTicket('')).toBe('<empty>');
  });
});
