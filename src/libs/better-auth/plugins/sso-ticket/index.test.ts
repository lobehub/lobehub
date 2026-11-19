import { describe, expect, it, vi } from 'vitest';

import { getSsoTicketConfig } from './config';
import {
  resolveSsoUser,
  runSsoTicketCallback,
  type SsoAccountLookup,
  type SsoTicketEndpointContext,
  type SsoTicketInternalAdapter,
  type SsoTicketRuntime,
  type SsoUserRecord,
} from './index';
import { SsoTicketError, type SsoTicketProfile } from './types';

class RedirectSignal extends Error {
  readonly url: string;

  constructor(url: string) {
    super(url);
    this.url = url;
  }
}

const config = getSsoTicketConfig({
  AUTH_SSO_TICKET_CLIENT_ID: 'lobehub',
  AUTH_SSO_TICKET_CLIENT_SECRET: 'secret',
  AUTH_SSO_TICKET_ENABLED: '1',
  AUTH_SSO_TICKET_EXCHANGE_URL: 'https://sso.example.com/exchange',
  AUTH_SSO_TICKET_LOGIN_DOMAIN: 'DEV',
});

const profile: SsoTicketProfile = {
  loginDomain: 'DEV',
  realName: '张三',
  roleCodes: ['developer'],
  userCode: 'A123456',
  userId: 'dev-user-001',
};

const existingUser: SsoUserRecord = {
  fullName: '张三',
  id: 'user-1',
  username: 'A123456',
};

function createAdapter() {
  return {
    createSession: vi.fn(async () => ({ token: 'session-token' })),
    createUser: vi.fn(
      async (data: Record<string, unknown>): Promise<SsoUserRecord> => ({ id: 'user-1', ...data }),
    ),
    findOAuthUser: vi.fn(
      async (): Promise<SsoAccountLookup | null> => null,
    ),
    linkAccount: vi.fn(async () => ({})),
    updateUser: vi.fn(
      async (id: string, data: Record<string, unknown>): Promise<SsoUserRecord> => ({
        id,
        ...data,
      }),
    ),
  };
}

function createContext(
  adapter: ReturnType<typeof createAdapter>,
  query: { redirect?: string; ticket?: string },
): { ctx: SsoTicketEndpointContext; redirect: ReturnType<typeof vi.fn>; logger: { error: ReturnType<typeof vi.fn> } } {
  const redirect = vi.fn((url: string) => {
    throw new RedirectSignal(url);
  });
  const logger = { error: vi.fn() };

  return {
    ctx: {
      context: {
        internalAdapter: adapter as unknown as SsoTicketInternalAdapter,
        logger,
      },
      query,
      redirect,
    },
    logger,
    redirect,
  };
}

function createRuntime(overrides: Partial<SsoTicketRuntime> = {}): SsoTicketRuntime {
  return {
    config,
    exchange: vi.fn(async () => profile),
    setSessionCookie: vi.fn(async () => {}),
    ...overrides,
  };
}

async function runToRedirect(ctx: SsoTicketEndpointContext, runtime: SsoTicketRuntime) {
  try {
    await runSsoTicketCallback(ctx, runtime);
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;

    throw error;
  }

  throw new Error('expected runSsoTicketCallback to redirect');
}

describe('runSsoTicketCallback', () => {
  it('creates a session and redirects to the default page on success', async () => {
    const adapter = createAdapter();
    adapter.findOAuthUser.mockResolvedValue({ linkedAccount: {}, user: existingUser });
    const runtime = createRuntime();
    const { ctx } = createContext(adapter, { ticket: 'ST-1234' });

    const url = await runToRedirect(ctx, runtime);

    expect(url).toBe('/');
    expect(adapter.createSession).toHaveBeenCalledWith('user-1');
    expect(runtime.setSessionCookie).toHaveBeenCalledWith(ctx, {
      session: { token: 'session-token' },
      user: existingUser,
    });
    expect(adapter.createUser).not.toHaveBeenCalled();
  });

  it('never leaks the ticket into the redirect URL', async () => {
    const adapter = createAdapter();
    adapter.findOAuthUser.mockResolvedValue({ linkedAccount: {}, user: existingUser });
    const { ctx } = createContext(adapter, { ticket: 'ST-SECRET-1234' });

    const url = await runToRedirect(ctx, createRuntime());

    expect(url).not.toContain('ST-SECRET');
  });

  it('redirects to an error page when the ticket is missing', async () => {
    const adapter = createAdapter();
    const runtime = createRuntime();
    const { ctx } = createContext(adapter, {});

    const url = await runToRedirect(ctx, runtime);

    expect(url).toBe('/auth-error?error=SSO_TICKET_MISSING');
    expect(runtime.setSessionCookie).not.toHaveBeenCalled();
    expect(adapter.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ['SSO_TICKET_INVALID', '/auth-error?error=SSO_TICKET_INVALID'],
    ['SSO_CLIENT_MISMATCH', '/auth-error?error=SSO_CLIENT_MISMATCH'],
    ['SSO_TICKET_USERINFO_INVALID', '/auth-error?error=SSO_TICKET_USERINFO_INVALID'],
  ] as const)('redirects with %s when exchange fails', async (code, expected) => {
    const adapter = createAdapter();
    const runtime = createRuntime({
      exchange: vi.fn(async () => {
        throw new SsoTicketError(code);
      }),
    });
    const { ctx } = createContext(adapter, { ticket: 'ST-1' });

    expect(await runToRedirect(ctx, runtime)).toBe(expected);
    expect(adapter.createSession).not.toHaveBeenCalled();
  });

  it('maps unexpected errors to SSO_EXCHANGE_UNAVAILABLE', async () => {
    const adapter = createAdapter();
    const runtime = createRuntime({
      exchange: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const { ctx } = createContext(adapter, { ticket: 'ST-1' });

    expect(await runToRedirect(ctx, runtime)).toBe('/auth-error?error=SSO_EXCHANGE_UNAVAILABLE');
  });

  it('logs client auth failures without leaking the ticket', async () => {
    const adapter = createAdapter();
    const runtime = createRuntime({
      exchange: vi.fn(async () => {
        throw new SsoTicketError('SSO_CLIENT_AUTH_INVALID');
      }),
    });
    const { ctx, logger } = createContext(adapter, { ticket: 'ST-SECRET-1234' });

    await runToRedirect(ctx, runtime);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const logged = String(logger.error.mock.calls[0][0]);
    expect(logged).not.toContain('ST-SECRET');
  });

  it('refuses an off-site redirect target', async () => {
    const adapter = createAdapter();
    adapter.findOAuthUser.mockResolvedValue({ linkedAccount: {}, user: existingUser });
    const { ctx } = createContext(adapter, { redirect: 'https://evil.com', ticket: 'ST-1' });

    expect(await runToRedirect(ctx, createRuntime())).toBe('/');
  });

  it('honours a safe in-site redirect target', async () => {
    const adapter = createAdapter();
    adapter.findOAuthUser.mockResolvedValue({ linkedAccount: {}, user: existingUser });
    const { ctx } = createContext(adapter, { redirect: '/chat/1', ticket: 'ST-1' });

    expect(await runToRedirect(ctx, createRuntime())).toBe('/chat/1');
  });
});

describe('resolveSsoUser', () => {
  it('creates a user and the tellhow-sso account on first login', async () => {
    const adapter = createAdapter();

    const { user } = await resolveSsoUser(
      adapter as unknown as SsoTicketInternalAdapter,
      profile,
      config,
    );

    expect(user.id).toBe('user-1');
    expect(adapter.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a123456@tellhow.com',
        emailVerified: true,
        fullName: '张三',
        username: 'A123456',
      }),
    );
    expect(adapter.linkAccount).toHaveBeenCalledWith({
      accountId: 'dev-user-001',
      providerId: 'tellhow-sso',
      userId: 'user-1',
    });
    expect(adapter.createSession).toHaveBeenCalledWith('user-1');
  });

  it('binds an existing email user instead of creating a duplicate', async () => {
    const adapter = createAdapter();
    adapter.findOAuthUser.mockResolvedValue({ linkedAccount: null, user: existingUser });

    const { user } = await resolveSsoUser(
      adapter as unknown as SsoTicketInternalAdapter,
      profile,
      config,
    );

    expect(user.id).toBe('user-1');
    expect(adapter.createUser).not.toHaveBeenCalled();
    expect(adapter.linkAccount).toHaveBeenCalledWith({
      accountId: 'dev-user-001',
      providerId: 'tellhow-sso',
      userId: 'user-1',
    });
  });

  it('keeps the same user when the employee code changes', async () => {
    const adapter = createAdapter();
    adapter.findOAuthUser.mockResolvedValue({ linkedAccount: {}, user: existingUser });

    const { user } = await resolveSsoUser(
      adapter as unknown as SsoTicketInternalAdapter,
      { ...profile, realName: '张三（新）', userCode: 'B0001' },
      config,
    );

    expect(user.id).toBe('user-1');
    expect(adapter.createUser).not.toHaveBeenCalled();
    expect(adapter.updateUser).toHaveBeenCalledWith('user-1', {
      fullName: '张三（新）',
      username: 'B0001',
    });
  });

  it('does not update unchanged profile fields', async () => {
    const adapter = createAdapter();
    adapter.findOAuthUser.mockResolvedValue({ linkedAccount: {}, user: existingUser });

    await resolveSsoUser(adapter as unknown as SsoTicketInternalAdapter, profile, config);

    expect(adapter.updateUser).not.toHaveBeenCalled();
  });

  it('rejects disabled users without creating a session', async () => {
    const adapter = createAdapter();
    adapter.findOAuthUser.mockResolvedValue({
      linkedAccount: {},
      user: { ...existingUser, banned: true },
    });

    await expect(
      resolveSsoUser(adapter as unknown as SsoTicketInternalAdapter, profile, config),
    ).rejects.toMatchObject({ code: 'SSO_USER_DISABLED' });

    expect(adapter.createSession).not.toHaveBeenCalled();
  });

  it('recovers when a concurrent first login already created the account', async () => {
    const adapter = createAdapter();
    adapter.createUser.mockRejectedValueOnce(new Error('unique constraint'));
    adapter.findOAuthUser.mockResolvedValue({ linkedAccount: {}, user: existingUser });

    const { user } = await resolveSsoUser(
      adapter as unknown as SsoTicketInternalAdapter,
      profile,
      config,
    );

    expect(user.id).toBe('user-1');
    expect(adapter.linkAccount).not.toHaveBeenCalled();
    expect(adapter.createSession).toHaveBeenCalledWith('user-1');
  });

  it('rethrows when the retry still cannot find the user', async () => {
    const adapter = createAdapter();
    adapter.createUser.mockRejectedValueOnce(new Error('unique constraint'));

    await expect(
      resolveSsoUser(adapter as unknown as SsoTicketInternalAdapter, profile, config),
    ).rejects.toThrow('unique constraint');
  });
});
