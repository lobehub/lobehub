import { checkUserAPIHandler } from '@/server/api-runtime/auth';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export type { CheckUserResponseData } from '@/server/api-runtime/auth';

/**
 * Check if a user exists by email
 * @param req - POST request with { email: string }
 * @returns { exists: boolean, emailVerified?: boolean }
 */
export const POST = createNextAPIRouteHandler('api-auth-check-user', checkUserAPIHandler);
