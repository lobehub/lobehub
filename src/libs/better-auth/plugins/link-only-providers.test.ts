import { beforeEach, describe, expect, it, vi } from 'vitest';

import { linkOnlyProviders } from './link-only-providers';

const { mockGetSessionFromCtx } = vi.hoisted(() => ({ mockGetSessionFromCtx: vi.fn() }));

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSessionFromCtx: mockGetSessionFromCtx,
}));

const [signInHook, unlinkHook] = linkOnlyProviders().hooks!.before!;

const run = (hook: typeof signInHook, ctx: Record<string, unknown>) =>
  (hook.handler as (ctx: unknown) => Promise<unknown>)(ctx);

describe('linkOnlyProviders', () => {
  describe('sign-in', () => {
    it('only intercepts social sign-in', () => {
      expect(signInHook.matcher({ path: '/sign-in/social' } as any)).toBe(true);
      expect(signInHook.matcher({ path: '/link-social' } as any)).toBe(false);
      expect(signInHook.matcher({ path: '/callback/:id' } as any)).toBe(false);
    });

    it('rejects sign-in with a link-only provider', async () => {
      await expect(
        run(signInHook, { body: { callbackURL: '/', provider: 'twitter' } }),
      ).rejects.toMatchObject({
        body: expect.objectContaining({ code: 'PROVIDER_LINK_ONLY' }),
        status: 'FORBIDDEN',
      });
    });

    it('allows sign-in with a regular provider', async () => {
      await expect(
        run(signInHook, { body: { callbackURL: '/', provider: 'github' } }),
      ).resolves.not.toThrow();
    });
  });

  describe('unlink', () => {
    const accounts = (...providerIds: string[]) =>
      providerIds.map((providerId, index) => ({
        accountId: `${providerId}-account`,
        id: `acc_${index}`,
        providerId,
      }));

    const unlink = (providerId: string, linked: ReturnType<typeof accounts>) =>
      run(unlinkHook, {
        body: { providerId },
        context: { internalAdapter: { findAccounts: vi.fn().mockResolvedValue(linked) } },
      });

    beforeEach(() => {
      mockGetSessionFromCtx.mockResolvedValue({ user: { id: 'user_1' } });
    });

    it('only intercepts unlinking', () => {
      expect(unlinkHook.matcher({ path: '/unlink-account' } as any)).toBe(true);
      expect(unlinkHook.matcher({ path: '/sign-in/social' } as any)).toBe(false);
    });

    it('rejects unlinking the last sign-in account when only a link-only account remains', async () => {
      await expect(unlink('google', accounts('google', 'twitter'))).rejects.toMatchObject({
        body: expect.objectContaining({ code: 'FAILED_TO_UNLINK_LAST_SIGN_IN_ACCOUNT' }),
        status: 'BAD_REQUEST',
      });
    });

    it('allows unlinking when another sign-in account remains', async () => {
      await expect(
        unlink('google', accounts('google', 'credential', 'twitter')),
      ).resolves.not.toThrow();
    });

    it('allows unlinking a link-only account', async () => {
      await expect(unlink('twitter', accounts('google', 'twitter'))).resolves.not.toThrow();
    });
  });
});
