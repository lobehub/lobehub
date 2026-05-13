import { resolveUsernameAPIHandler } from '@/server/api-runtime/auth';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export type { ResolveUsernameResponseData } from '@/server/api-runtime/auth';

/**
 * Resolve a username to the associated email address.
 * @param req - POST request with { username: string }
 * @returns { exists: boolean, email?: string | null }
 */
export const POST = createNextAPIRouteHandler(
  'api-auth-resolve-username',
  resolveUsernameAPIHandler,
);
