import { describe, expect, it } from 'vitest';

import { createContextInner } from './context';

describe('createContextInner', () => {
  it('should create context with default values when no params provided', async () => {
    const context = await createContextInner();

    expect(context).toMatchObject({
      authorizationHeader: undefined,
      marketAccessToken: undefined,
      oidcAuth: undefined,
      userAgent: undefined,
      userId: undefined,
    });
    expect(context.resHeaders).toBeInstanceOf(Headers);
  });

  it('should create context with userId', async () => {
    const context = await createContextInner({ userId: 'user-123' });

    expect(context.userId).toBe('user-123');
  });

  it('should create context with authorization header', async () => {
    const context = await createContextInner({
      authorizationHeader: 'Bearer token-abc',
    });

    expect(context.authorizationHeader).toBe('Bearer token-abc');
  });

  it('should create context with user agent', async () => {
    const context = await createContextInner({
      userAgent: 'Mozilla/5.0',
    });

    expect(context.userAgent).toBe('Mozilla/5.0');
  });

  it('should create context with market access token', async () => {
    const context = await createContextInner({
      marketAccessToken: 'mp-token-xyz',
    });

    expect(context.marketAccessToken).toBe('mp-token-xyz');
  });

  it('should create context with OIDC auth data', async () => {
    const oidcAuth = {
      sub: 'oidc-user-123',
      payload: { iss: 'https://issuer.com', aud: 'client-id' },
    };

    const context = await createContextInner({ oidcAuth });

    expect(context.oidcAuth).toEqual(oidcAuth);
  });

  it('should create context with all parameters combined', async () => {
    const params = {
      authorizationHeader: 'Bearer token',
      userId: 'user-123',
      userAgent: 'Test Agent',
      marketAccessToken: 'mp-token',
      oidcAuth: {
        sub: 'oidc-sub',
        payload: { data: 'test' },
      },
    };

    const context = await createContextInner(params);

    expect(context).toMatchObject({
      authorizationHeader: 'Bearer token',
      userId: 'user-123',
      userAgent: 'Test Agent',
      marketAccessToken: 'mp-token',
      oidcAuth: { sub: 'oidc-sub', payload: { data: 'test' } },
    });
  });

  it('should always include response headers', async () => {
    const context1 = await createContextInner();
    const context2 = await createContextInner({ userId: 'test' });

    expect(context1.resHeaders).toBeInstanceOf(Headers);
    expect(context2.resHeaders).toBeInstanceOf(Headers);
  });
});
