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
 * identity, which makes `messageCount` the one field on it that
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

  it('skips the count unless the caller opts in, even for full-access callers', async () => {
    for (const auth of [{ authType: 'apikey', scopes: ['*'] }, { authType: 'oidc' }]) {
      await new UserController().getCurrentUser(contextFor(auth));
      expect(getCurrentUser).toHaveBeenLastCalledWith(false);

      for (const query of ['includeCount=0', 'includeCount=false', 'includeCount=yes']) {
        await new UserController().getCurrentUser(contextFor(auth, query));
        expect(getCurrentUser).toHaveBeenLastCalledWith(false);
      }
    }
  });

  it('withholds an opted-in count from a restricted key without chat:read, without failing', async () => {
    const res = await new UserController().getCurrentUser(
      contextFor({ authType: 'apikey', scopes: ['agent:read'] }, 'includeCount=1'),
    );

    expect(res.status).toBe(200);
    expect(getCurrentUser).toHaveBeenCalledWith(false);
  });

  it('returns an opted-in count to a restricted key holding chat:read', async () => {
    await new UserController().getCurrentUser(
      contextFor({ authType: 'apikey', scopes: ['chat:read'] }, 'includeCount=1'),
    );

    expect(getCurrentUser).toHaveBeenCalledWith(true);
  });

  it('returns an opted-in count to full-access keys and session callers', async () => {
    for (const auth of [
      { authType: 'apikey', scopes: ['*'] },
      { authType: 'apikey', scopes: null },
      { authType: 'oidc' },
    ]) {
      for (const query of ['includeCount=1', 'includeCount=true']) {
        await new UserController().getCurrentUser(contextFor(auth, query));
        expect(getCurrentUser).toHaveBeenLastCalledWith(true);
      }
    }
  });
});
