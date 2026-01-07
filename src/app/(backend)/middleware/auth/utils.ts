import { type AuthObject } from '@clerk/backend';
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { enableBetterAuth, enableClerk, enableNextAuth } from '@/envs/auth';

interface CheckAuthParams {
  apiKey?: string;
  betterAuthAuthorized?: boolean;
  clerkAuth?: AuthObject;
  nextAuthAuthorized?: boolean;
}
/**
 * Check if authentication is valid based on various auth methods.
 *
 * @param {CheckAuthParams} params - Authentication parameters extracted from headers.
 * @param {string} [params.apiKey] - The user API key.
 * @param {boolean} [params.betterAuthAuthorized] - Whether the Better Auth session exists.
 * @param {AuthObject} [params.clerkAuth] - Clerk authentication payload from middleware.
 * @param {boolean} [params.nextAuthAuthorized] - Whether the OAuth 2 header is provided.
 * @throws {AgentRuntimeError} If authentication fails.
 */
export const checkAuthMethod = (params: CheckAuthParams) => {
  const { apiKey, betterAuthAuthorized, nextAuthAuthorized, clerkAuth } = params;
  // clerk auth handler
  if (enableClerk) {
    // if there is no userId, means the use is not login, just throw error
    if (!(clerkAuth as any)?.userId)
      throw AgentRuntimeError.createError(ChatErrorType.InvalidClerkUser);
    // if the user is login, just return
    else return;
  }

  // if better auth session exists
  if (enableBetterAuth && betterAuthAuthorized) return;

  // if next auth handler is provided
  if (enableNextAuth && nextAuthAuthorized) return;

  // if apiKey exist
  if (apiKey) return;
};
