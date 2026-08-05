import { matchRoutes, type RouteObject } from 'react-router';

const MAIN_LAYOUT_PATH = '/';

/**
 * Whether the boot url lands inside the main layout.
 *
 * The shell draws the main-app chrome — nav panel column plus the rounded
 * container — so it is only an honest placeholder for routes that actually
 * render that chrome. `/onboarding`, `/share/t/:id` and `/verify` are siblings
 * of the main-layout root, not children: showing them a nav panel that never
 * arrives is worse than showing the brand logo they already fall back to.
 *
 * Note this is not a "known route" test: the main area carries a
 * `:workspaceSlug` segment, so an unrecognised path is read as a workspace and
 * genuinely does render the main layout. Only the explicit siblings are
 * excluded. That also means the basename must be passed — otherwise a
 * `/_dangerous_local_dev_proxy/...` url has its prefix eaten as a slug.
 */
export const isMainLayoutLocation = (
  routes: RouteObject[],
  pathname: string,
  basename?: string,
): boolean => matchRoutes(routes, pathname, basename)?.[0]?.route.path === MAIN_LAYOUT_PATH;
