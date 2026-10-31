/**
 * Whether this bundle is the mobile SPA (`entry.mobile.tsx`). The router is
 * chosen by the bundle, not by the viewport — a landscape phone above the mobile
 * breakpoint still runs the mobile router. Read per call so tests can stub
 * `__MOBILE__`.
 */
export const isMobileSurface = () => typeof __MOBILE__ !== 'undefined' && __MOBILE__;
