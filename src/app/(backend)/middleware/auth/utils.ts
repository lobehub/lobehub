import { type AuthObject } from '@clerk/backend';
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { enableBetterAuth, enableClerk, enableNextAuth } from '@/const/auth';
import { getAppConfig } from '@/envs/app';

interface CheckAuthParams {
  accessCode?: string;
  apiKey?: string;
  betterAuthAuthorized?: boolean;
  clerkAuth?: AuthObject;
  nextAuthAuthorized?: boolean;
}
/**
 * Check if the provided access code is valid, a user API key should be used or the OAuth 2 header is provided.
 *
 * @param {CheckAuthParams} params - Authentication parameters extracted from headers.
 * @param {string} [params.accessCode] - The access code to check.
 * @param {string} [params.apiKey] - The user API key.
 * @param {boolean} [params.betterAuthAuthorized] - Whether the Better Auth session exists.
 * @param {AuthObject} [params.clerkAuth] - Clerk authentication payload from middleware.
 * @param {boolean} [params.nextAuthAuthorized] - Whether the OAuth 2 header is provided.
 * @throws {AgentRuntimeError} If the access code is invalid and no user API key is provided.
 */
export const checkAuthMethod = (params: CheckAuthParams) => {
  const { apiKey, betterAuthAuthorized, nextAuthAuthorized, accessCode, clerkAuth } = params;
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

  const { ACCESS_CODES } = getAppConfig();

  // if accessCode doesn't exist
  if (!ACCESS_CODES.length) return;

  if (!accessCode || !ACCESS_CODES.includes(accessCode)) {
    // Avoid logging user-provided credentials (access code) for security reasons
    console.warn('Invalid access code provided');
    throw AgentRuntimeError.createError(ChatErrorType.InvalidAccessCode);
  }
};
