import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

interface CheckAuthParams {
  betterAuthAuthorized?: boolean;
}

/**
 * Check if authentication is valid.
 * Only accepts a verified server-side session (Better Auth).
 */
export const checkAuthMethod = (params: CheckAuthParams) => {
  const { betterAuthAuthorized } = params;

  if (betterAuthAuthorized) return;

  throw AgentRuntimeError.createError(ChatErrorType.Unauthorized);
};
