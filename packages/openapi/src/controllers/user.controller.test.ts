import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUser = vi.hoisted(() => vi.fn());

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/rbac', () => ({ RbacModel: class {} }));
vi.mock('../services', () => ({
  UserService: class {
    getCurrentUser = getCurrentUser;
  },
}));

const { UserController } = await import('./user.controller');

/**
 * `/me` is open to any authenticated caller so a key can resolve its own
 * identity (LOBE-12934), which makes `messageCount` the one field on it that
 * still needs gating — it is chat-usage metadata, not identity.
 */
describe('UserController.getCurrentUser', () => {
  const contextFor = (auth: { authType?: string; scopes?: string[] | null }, query = '') => {
    const values: Record<string, unknown> = {
      apiKeyScopes: auth.scopes,
      authType: auth.authType,
      userId: 'user-1',
    };

    return {
      get: (key: string) => values[key],
      json: (body: unknown) => new Response(JSON.stringify(body)),
      req: { query: (key: string) => new URLSearchParams(query).get(key) ?? undefined },
    } as unknown as Context;
  };

  const FULL_PROFILE = {
    email: 'someone@example.com',
    fullName: 'Someone',
    id: 'user-1',
    messageCount: 42,
    phone: '+100000000',
    preference: { language: 'zh-CN' },
    roles: [{ id: 'role-1', name: 'admin' }],
  };

  const bodyOf = async (res: Response) => (await res.json()).data;

  beforeEach(() => {
    getCurrentUser.mockReset();
    getCurrentUser.mockResolvedValue(FULL_PROFILE);
  });

  describe('profile projection', () => {
    it('narrows the response to the id for a key without user:read', async () => {
      const res = await new UserController().getCurrentUser(
        contextFor({ authType: 'apikey', scopes: ['model:invoke'] }),
      );

      await expect(bodyOf(res)).resolves.toEqual({ id: 'user-1' });
    });

    it('returns the full profile to a key holding user:read', async () => {
      const res = await new UserController().getCurrentUser(
        contextFor({ authType: 'apikey', scopes: ['user:read'] }),
      );

      await expect(bodyOf(res)).resolves.toMatchObject({
        email: FULL_PROFILE.email,
        roles: FULL_PROFILE.roles,
      });
    });

    it('returns the full profile to full-access keys and session callers', async () => {
      for (const auth of [
        { authType: 'apikey', scopes: ['*'] },
        { authType: 'apikey', scopes: null },
        { authType: 'oidc' },
      ]) {
        const res = await new UserController().getCurrentUser(contextFor(auth));

        await expect(bodyOf(res)).resolves.toMatchObject({ email: FULL_PROFILE.email });
      }
    });
  });

  it('withholds the count from a restricted key without chat:read, without failing', async () => {
    const res = await new UserController().getCurrentUser(
      contextFor({
        authType: 'apikey',
        scopes: ['agent:read'],
      }),
    );

    expect(res.status).toBe(200);
    expect(getCurrentUser).toHaveBeenCalledWith(false);
  });

  it('returns the count to a restricted key holding chat:read', async () => {
    await new UserController().getCurrentUser(
      contextFor({ authType: 'apikey', scopes: ['chat:read'] }),
    );

    expect(getCurrentUser).toHaveBeenCalledWith(true);
  });

  it('returns the count to full-access keys and session callers', async () => {
    await new UserController().getCurrentUser(contextFor({ authType: 'apikey', scopes: ['*'] }));
    expect(getCurrentUser).toHaveBeenLastCalledWith(true);

    await new UserController().getCurrentUser(contextFor({ authType: 'apikey', scopes: null }));
    expect(getCurrentUser).toHaveBeenLastCalledWith(true);

    await new UserController().getCurrentUser(contextFor({ authType: 'oidc' }));
    expect(getCurrentUser).toHaveBeenLastCalledWith(true);
  });

  it('still honours an explicit includeCount=0 for permitted callers', async () => {
    await new UserController().getCurrentUser(contextFor({ authType: 'oidc' }, 'includeCount=0'));

    expect(getCurrentUser).toHaveBeenCalledWith(false);
  });
});
