import { APIError, createAuthMiddleware } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

/** Server-enforced minimum (AUTH-003); keep in sync with signup/reset UI. */
export const PASSWORD_MIN_LENGTH = 10;

const PASSWORD_PATHS = new Set(['/sign-up/email', '/change-password', '/reset-password']);

export const meetsPasswordComplexity = (password: string): boolean =>
  /[A-Z]/i.test(password) && /\d/.test(password);

const passwordFromBody = (body: Record<string, unknown> | undefined): string | null => {
  if (!body) return null;
  if (typeof body.password === 'string') return body.password;
  if (typeof body.newPassword === 'string') return body.newPassword;
  return null;
};

/**
 * Better Auth plugin: require letter + digit on password-setting paths (AUTH-003).
 * Length is still enforced via `emailAndPassword.minPasswordLength`.
 */
export const passwordPolicy = (): BetterAuthPlugin => ({
  id: 'aico-password-policy',
  hooks: {
    before: [
      {
        matcher: (ctx) => PASSWORD_PATHS.has(ctx.path),
        handler: createAuthMiddleware(async (ctx) => {
          const password = passwordFromBody(ctx.body as Record<string, unknown> | undefined);
          if (password === null) return;

          if (!meetsPasswordComplexity(password)) {
            throw new APIError('BAD_REQUEST', {
              code: 'PASSWORD_TOO_WEAK',
              message: 'PASSWORD_TOO_WEAK',
            });
          }
        }),
      },
    ],
  },
});
