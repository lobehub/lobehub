const AGENT_DOCUMENT_ROUTE = /^\/agent\/[^/]+\/docs\/[^/]+\/?$/;
const ACCEPTANCE_ROUTE = /^\/acceptance(?:\/[^/]+(?:\/check\/[^/]+)?)?\/?$/;
const VERIFY_ROUTE = /^\/verify(?:\/[^/]+)?\/?$/;

const pathOnly = (pathname: string) => pathname.split(/[?#]/, 1)[0]!;

/** `/verify` and `/acceptance` — Workbench for every user agent. */
export const isAlwaysWorkbenchSpaRoute = (pathname: string): boolean => {
  const path = pathOnly(pathname);

  return ACCEPTANCE_ROUTE.test(path) || VERIFY_ROUTE.test(path);
};

/** Every path Workbench can own, including mobile-only agent documents. */
export const isWorkbenchSpaRoute = (pathname: string): boolean => {
  const path = pathOnly(pathname);

  return AGENT_DOCUMENT_ROUTE.test(path) || isAlwaysWorkbenchSpaRoute(path);
};
