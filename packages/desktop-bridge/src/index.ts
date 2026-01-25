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
