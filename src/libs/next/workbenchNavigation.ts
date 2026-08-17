import { isAlwaysWorkbenchSpaRoute, isWorkbenchSpaRoute } from './workbenchRoutes';

/**
 * Main SPA routes that cross into the independent Workbench runtime must
 * perform a document navigation. Inside Workbench, React Router remains local.
 * Electron keeps its own renderer router and is not rewritten by Next.
 */
export const shouldHardNavigateToWorkbench = (pathname: string): boolean => {
  if (typeof __WORKBENCH__ !== 'undefined' && __WORKBENCH__) return false;
  if (typeof __ELECTRON__ !== 'undefined' && __ELECTRON__) return false;
  if (isAlwaysWorkbenchSpaRoute(pathname)) return true;

  return typeof __MOBILE__ !== 'undefined' && __MOBILE__ && isWorkbenchSpaRoute(pathname);
};
