import { describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_GOOGLE_ID: 'google-client-id',
    AUTH_GOOGLE_SECRET: 'google-client-secret',
  },
}));

describe('Google SSO provider', () => {
  it('should prompt account selection during OAuth sign in', async () => {
    const { default: provider } = await import('./google');

    const env = provider.checkEnvs();

    expect(env).toEqual({
      AUTH_GOOGLE_ID: 'google-client-id',
      AUTH_GOOGLE_SECRET: 'google-client-secret',
    });
    expect(env && provider.build(env)).toEqual(
      expect.objectContaining({
        prompt: 'select_account',
      }),
    );
  });
});
