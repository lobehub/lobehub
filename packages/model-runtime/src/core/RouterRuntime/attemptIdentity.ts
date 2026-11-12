import type { OnUsageCallback, RouteAttemptIdentity } from '../../types';
import type { RouteAttemptStart } from './routeAttempt';

/**
 * Written to `options.metadata.routeAttempt` once an attempt succeeds; read back with
 * `readRouteAttemptIdentity` by callers that bill after the method returns.
 */
export interface RouteAttemptMetadata {
  apiType: string;
  attemptId: string;
  channelId?: string;
  completionPending?: boolean;
  durationMs: number;
  optionIndex: number;
  providerId: string;
  requestId: string;
  routerId?: string;
  success: boolean;
  totalOptions: number;
}

/**
 * Tags the usage an attempt reports with that attempt's identity, so billing hooks know which
 * channel served it. Per attempt, because a failed attempt's usage must not inherit the identity
 * of the attempt that eventually succeeds.
 */
export const withAttemptUsage = <T extends { onUsage?: OnUsageCallback }>(
  options: T | undefined,
  attempt: RouteAttemptStart,
): T | undefined => {
  const onUsage = options?.onUsage;
  if (!onUsage) return options;

  const routeAttempt: RouteAttemptIdentity = {
    attemptId: attempt.attemptId,
    channelId: attempt.channelId,
    requestId: attempt.requestId,
    routerId: attempt.routerId,
  };
  return {
    ...options,
    onUsage: (usage, context) => onUsage(usage, { ...context, routeAttempt }),
  };
};
