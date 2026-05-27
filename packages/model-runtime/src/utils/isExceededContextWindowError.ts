import { AgentRuntimeErrorType } from '@lobechat/types';

import { matchErrorPattern } from '../errors';

/**
 * Returns true when `message` looks like a context-window-exceeded error from
 * any known provider. The substring registry lives in `errors/patterns.ts`
 * (search for `ExceededContextWindow`).
 */
export const isExceededContextWindowError = (message?: string): boolean => {
  if (!message) return false;
  return matchErrorPattern({ message })?.code === AgentRuntimeErrorType.ExceededContextWindow;
};
