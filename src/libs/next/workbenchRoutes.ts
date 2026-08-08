const AGENT_DOCUMENT_ROUTE = /^\/agent\/[^/]+\/docs\/[^/]+\/?$/;
const ACCEPTANCE_ROUTE = /^\/acceptance(?:\/[^/]+(?:\/check\/[^/]+)?)?\/?$/;

/** Routes owned by the mobile Workbench SPA at the public URL boundary. */
export const isWorkbenchSpaRoute = (pathname: string): boolean => {
  const pathOnly = pathname.split(/[?#]/, 1)[0]!;

  return AGENT_DOCUMENT_ROUTE.test(pathOnly) || ACCEPTANCE_ROUTE.test(pathOnly);
};
