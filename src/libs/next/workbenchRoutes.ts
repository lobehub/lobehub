const AGENT_DOCUMENT_ROUTE = /^\/agent\/[^/]+\/docs\/[^/]+\/?$/;
const VERIFY_ROUTE = /^\/verify(?:\/[^/]+)?\/?$/;

const pathOnly = (pathname: string) => pathname.split(/[?#]/, 1)[0]!;

export const isAlwaysWorkbenchSpaRoute = (pathname: string): boolean => {
  const path = pathOnly(pathname);

  return VERIFY_ROUTE.test(path);
};

/** Every path Workbench can own, including mobile-only agent documents. */
export const isWorkbenchSpaRoute = (pathname: string): boolean => {
  const path = pathOnly(pathname);

  return AGENT_DOCUMENT_ROUTE.test(path) || isAlwaysWorkbenchSpaRoute(path);
};
