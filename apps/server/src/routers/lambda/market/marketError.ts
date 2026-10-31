import { MarketAPIError } from '@lobehub/market-sdk';
import { TRPCError } from '@trpc/server';

/**
 * Note the deliberate absence of `401`.
 *
 * `UNAUTHORIZED` is not an inert status code here — it drives re-authentication
 * UI. `createResponseMeta` tags any `UNAUTHORIZED` whose message isn't the
 * `MARKET_AUTH_REQUIRED_MESSAGE` sentinel with `X-Auth-Required`, and the
 * desktop proxy opens the LobeHub re-login prompt on that header. Mapping an
 * upstream 401 through would therefore ask the user to re-sign into LobeHub
 * because *Market* rejected a credential.
 *
 * Signing into LobeHub cannot repair a credential Market rejected (a broken
 * server trusted-client token/config, or an expired Market token). Procedures
 * that need the user to sign into Market must say so explicitly with the
 * `MARKET_AUTH_REQUIRED_MESSAGE` sentinel / `requireMarketAuth`, not through
 * this generic mapper. So a 401 stays a 500.
 */
const MARKET_STATUS_TO_TRPC_CODE: Record<number, TRPCError['code']> = {
  400: 'BAD_REQUEST',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * Preserve the upstream Market status instead of collapsing everything into a
 * blanket 500.
 *
 * This matters most for `429`: Market rate limits these endpoints, and a client
 * that only sees `INTERNAL_SERVER_ERROR` cannot tell a transient throttle from a
 * real outage — so it retries with exponential backoff, and those retries land
 * inside the same rate-limit window and keep the bucket empty. Surfacing
 * `TOO_MANY_REQUESTS` lets the SWR retry gate stand down (see `useClientDataSWR`)
 * and lets the UI say something true.
 */
export function mapMarketError(error: unknown, fallbackMessage: string): TRPCError {
  // Already mapped upstream (e.g. by a nested helper); re-wrapping would lose its code.
  if (error instanceof TRPCError) return error;
  if (error instanceof MarketAPIError) {
    return new TRPCError({
      cause: error,
      code: MARKET_STATUS_TO_TRPC_CODE[error.status] ?? 'INTERNAL_SERVER_ERROR',
      message: error.message || fallbackMessage,
    });
  }
  return new TRPCError({ cause: error, code: 'INTERNAL_SERVER_ERROR', message: fallbackMessage });
}
