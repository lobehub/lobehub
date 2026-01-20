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
