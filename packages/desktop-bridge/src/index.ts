// Shared routing/locale utilities for desktop and web (centralized here)
export {
  DEFAULT_LANG,
  DEFAULT_VARIANTS,
  type IRouteVariants,
  type Locales,
  locales,
  RouteVariants,
} from './routeVariants';

// Desktop window constants
export const TITLE_BAR_HEIGHT = 38;

export const APP_WINDOW_MIN_SIZE = {
  height: 600,
  width: 1000,
} as const;

// HTTP Headers for desktop-server communication
/**
 * Header to indicate that a 401 response is due to a real authentication failure
 * (e.g., token expired) rather than other 401 causes (e.g., invalid API keys).
 *
 * When the server sets this header to 'true', the desktop app should trigger
 * re-authentication flow.
 */
export const AUTH_REQUIRED_HEADER = 'X-Auth-Required';

// TRPC error codes (mirrors @trpc/server internal codes)
/**
 * TRPC error code for unauthorized requests.
 * Used to identify authentication failures in TRPC responses.
 */
export const TRPC_ERROR_CODE_UNAUTHORIZED = 'UNAUTHORIZED' as const;

/**
 * Sentinel message placed in TRPCError({ code: 'UNAUTHORIZED' }) when the failure
 * originates from the Market service's own OAuth token, NOT from the user's LobeHub
 * session.  responseMeta checks this to suppress the X-Auth-Required header so the
 * desktop "re-login to LobeHub" modal is NOT shown; the Market OAuth flow handles it
 * instead via the market-unauthorized event.
 */
export const MARKET_AUTH_REQUIRED_MESSAGE = 'MARKET_AUTH_REQUIRED' as const;
