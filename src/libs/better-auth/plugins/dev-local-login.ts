import { APIError } from 'better-auth/api';
import { createAuthEndpoint } from 'better-auth/plugins';
import type { BetterAuthPlugin } from 'better-auth/types';
import { z } from 'zod';

interface DevLoginEnv {
  LOBE_DEV_AUTH_BOOTSTRAP?: string;
  NODE_ENV?: string;
}

const devLocalLoginQuerySchema = z.object({
  callbackURL: z.string().optional(),
  email: z.string().email(),
  name: z.string().optional(),
});

export const isDevLocalLoginEnabled = (env: DevLoginEnv = process.env) =>
  env.NODE_ENV === 'development' && env.LOBE_DEV_AUTH_BOOTSTRAP === '1';

export const resolveDevLocalLoginCallback = (value: string | undefined) => {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';

  return value;
};

const resolveDevUserName = (email: string, value: string | undefined) => {
  const name = value?.trim();
  if (name) return name;

  return email.split('@')[0] || 'Local Dev';
};

export const devLocalLogin = (): BetterAuthPlugin => ({
  endpoints: {
    devLocalLogin: createAuthEndpoint(
      '/dev/local-login',
      {
        method: 'GET',
        query: devLocalLoginQuerySchema,
      },
      async (ctx) => {
        if (!isDevLocalLoginEnabled()) {
          throw new APIError('NOT_FOUND', { message: 'dev local login is disabled' });
        }

        const email = ctx.query.email.toLowerCase();
        const existing = await ctx.context.internalAdapter.findUserByEmail(email);
        const user =
          existing?.user ||
          (await ctx.context.internalAdapter.createUser({
            email,
            emailVerified: true,
            name: resolveDevUserName(email, ctx.query.name),
          }));
        const session = await ctx.context.internalAdapter.createSession(user.id);

        await ctx.setSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          session.token,
          ctx.context.secret,
          ctx.context.authCookies.sessionToken.options,
        );

        throw ctx.redirect(resolveDevLocalLoginCallback(ctx.query.callbackURL));
      },
    ),
  },
  id: 'dev-local-login',
});
