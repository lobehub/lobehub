const AGENT_DOCUMENT_ROUTE = /^\/agent\/[^/]+\/docs\/[^/]+\/?$/;

const pathOnly = (pathname: string) => pathname.split(/[?#]/, 1)[0]!;

/** Every path Workbench can own: mobile-only agent documents. */
export const isWorkbenchSpaRoute = (pathname: string): boolean =>
  AGENT_DOCUMENT_ROUTE.test(pathOnly(pathname));
