import { isWorkbenchSpaRoute } from './workbenchRoutes';

/**
 * Main Mobile SPA routes that cross into the independent Workbench runtime must
 * perform a document navigation. Inside Workbench, React Router remains local.
 */
export const shouldHardNavigateToWorkbench = (pathname: string): boolean =>
  typeof __MOBILE__ !== 'undefined' &&
  __MOBILE__ &&
  (typeof __WORKBENCH__ === 'undefined' || !__WORKBENCH__) &&
  isWorkbenchSpaRoute(pathname);
