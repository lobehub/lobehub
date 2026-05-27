import { AgentRuntimeErrorType } from '@lobechat/types';

import { matchErrorPattern } from '../errors';

/**
 * Returns true when `message` looks like an account-deactivated / suspended
 * error. The substring registry lives in `errors/patterns.ts` (search for
 * `AccountDeactivated`).
 */
export const isAccountDeactivatedError = (message?: string): boolean => {
  if (!message) return false;
  return matchErrorPattern({ message })?.code === AgentRuntimeErrorType.AccountDeactivated;
};
