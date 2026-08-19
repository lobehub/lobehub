import { isAlwaysWorkbenchSpaRoute, isWorkbenchSpaRoute } from './workbenchRoutes';

export const shouldHardNavigateToWorkbench = (pathname: string): boolean => {
  if (typeof __ELECTRON__ !== 'undefined' && __ELECTRON__) return false;
  if (isAlwaysWorkbenchSpaRoute(pathname)) return true;

  return typeof __MOBILE__ !== 'undefined' && __MOBILE__ && isWorkbenchSpaRoute(pathname);
};
