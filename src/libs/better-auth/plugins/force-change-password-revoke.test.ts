import { describe, expect, it, vi } from 'vitest';

vi.mock('better-auth/api', () => ({
  createAuthMiddleware: (handler: (ctx: unknown) => unknown) => handler,
}));

describe('forceChangePasswordRevoke', () => {
  it('forces revokeOtherSessions on /change-password', async () => {
    const { forceChangePasswordRevoke } = await import('./force-change-password-revoke');
    const plugin = forceChangePasswordRevoke();
    const hook = plugin.hooks?.before?.[0];
    expect(hook?.matcher({ path: '/change-password' } as never)).toBe(true);
    expect(hook?.matcher({ path: '/sign-up/email' } as never)).toBe(false);

    const result = await (hook!.handler as (ctx: unknown) => Promise<unknown>)({
      body: { currentPassword: 'old', newPassword: 'Password123!', revokeOtherSessions: false },
      path: '/change-password',
    });

    expect(result).toEqual({
      context: {
        body: {
          currentPassword: 'old',
          newPassword: 'Password123!',
          revokeOtherSessions: true,
        },
      },
    });
  });
});
