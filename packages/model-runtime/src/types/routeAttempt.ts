import type { ModelUsage } from '@lobechat/types';

/**
 * Stable identity of the router attempt that served a request, so billing can attribute the
 * usage to the channel that produced it.
 */
export interface RouteAttemptIdentity {
  attemptId: string;
  /** Router channel that served the attempt. */
  channelId?: string;
  requestId: string;
  routerId?: string;
}

/**
 * A routed chat attempt that reached a terminal empty or interrupted outcome without visible
 * output and was replaced by a retry or fallback. None of its stream callbacks ran, so this is
 * the only report of any usage the upstream may still bill.
 */
export interface DiscardedChatAttempt extends RouteAttemptIdentity {
  durationMs: number;
  /** Raw provider finish reason, e.g. Gemini `MALFORMED_RESPONSE`. */
  finishReason?: string;
  outcome: 'empty' | 'interrupted';
  usage?: ModelUsage;
}

/** Second `onUsage` argument, filled by RouterRuntime for the attempt that reported the usage. */
export interface UsageReportContext {
  routeAttempt?: RouteAttemptIdentity;
}

export type OnUsageCallback = (
  usage: ModelUsage,
  context?: UsageReportContext,
) => void | Promise<void>;

/**
 * Reads the identity RouterRuntime attaches to `options.metadata.routeAttempt` once an attempt
 * succeeds. Methods whose result is billed after they return (image, video) carry it this way.
 */
export const readRouteAttemptIdentity = (
  metadata: Record<string, unknown> | undefined,
): RouteAttemptIdentity | undefined => {
  const value = metadata?.routeAttempt;
  if (!value || typeof value !== 'object') return;

  const { attemptId, channelId, requestId, routerId } = value as Record<string, unknown>;
  if (typeof attemptId !== 'string' || typeof requestId !== 'string') return;

  return {
    attemptId,
    requestId,
    ...(typeof channelId === 'string' ? { channelId } : {}),
    ...(typeof routerId === 'string' ? { routerId } : {}),
  };
};
