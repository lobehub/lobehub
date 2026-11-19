import { MarketAPIError } from '@lobehub/market-sdk';
import { serialize } from 'cookie';

/** Bound on the `cause` chain walk, so a cyclic chain cannot loop forever. */
const MAX_CAUSE_DEPTH = 8;

/**
 * Whether Market rejected the access token this request sent (`401`).
 *
 * Procedures wrap the SDK error in a `TRPCError`, so the `MarketAPIError` is
 * found by walking `cause`.
 */
export const isMarketTokenRejected = (error: unknown): boolean => {
  let current: unknown = error;

  for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth++) {
    if (current instanceof MarketAPIError) return current.status === 401;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
};

interface RetryDecisionParams {
  accessToken?: string;
  error: unknown;
  type: string;
}

/**
 * A query that failed only because Market rejected the token can be answered
 * anonymously: catalog reads (MCP, skill, assistant lists) are public.
 *
 * Without this fallback a stale token breaks every catalog page until it
 * expires: the client trusts the `mp_token_status` cookie until its expiry and
 * never asks for a new token while that cookie says `active`.
 *
 * Mutations are never retried: they act on the user's behalf, and dropping
 * the credential would either fail differently or act as someone else.
 */
export const shouldRetryWithoutMarketToken = ({
  accessToken,
  error,
  type,
}: RetryDecisionParams): boolean =>
  type === 'query' && !!accessToken && isMarketTokenRejected(error);

/**
 * Expire the M2M token cookies so the client registers a fresh token on its
 * next request. `path` must match the one the cookies were set with, or the
 * browser keeps the original cookie.
 */
export const expiredMarketTokenCookies = (): string[] => [
  serialize('mp_token', '', { maxAge: -1, path: '/' }),
  serialize('mp_token_status', '', { maxAge: -1, path: '/' }),
];
