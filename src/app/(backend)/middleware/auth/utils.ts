import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

interface CheckAuthParams {
  apiKey?: string;
  betterAuthAuthorized?: boolean;
  nextAuthAuthorized?: boolean;
}
/**
 * Check if authentication is valid based on various auth methods.
 *
 * @param {CheckAuthParams} params - Authentication parameters extracted from headers.
 * @param {string} [params.apiKey] - The user API key.
 * @param {boolean} [params.betterAuthAuthorized] - Whether the Better Auth session exists.
 * @param {boolean} [params.nextAuthAuthorized] - Whether the OAuth 2 header is provided (legacy, kept for compatibility).
 * @throws {AgentRuntimeError} If no valid authentication method is found.
 */
export const checkAuthMethod = (params: CheckAuthParams) => {
  const { apiKey, betterAuthAuthorized } = params;

  // if better auth session exists
  if (betterAuthAuthorized) return;

  // if apiKey exist
  if (apiKey) return;

  throw AgentRuntimeError.createError(ChatErrorType.Unauthorized);
};
