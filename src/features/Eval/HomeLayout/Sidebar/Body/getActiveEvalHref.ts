const OWNERS = [/^\/eval\/bench\/[^/]+/, /^\/eval\/datasets\/[^/]+/, /^\/eval\/experiments\/[^/]+/];

/**
 * The sidebar item that owns a pathname: a benchmark stays active on its runs
 * and cases, a dataset on its sub-pages. `/eval` itself is the dashboard; any
 * other eval page (a comparison, a case) has no owner in the sidebar.
 */
export const getActiveEvalHref = (pathname: string): string | undefined => {
  // Workspace routes mirror eval under `/:workspaceSlug/eval/...`.
  const path = pathname.replace(/^\/[^/]+(?=\/eval(\/|$))/, '').replace(/\/$/, '');
  if (path === '/eval') return '/eval';
  for (const owner of OWNERS) {
    const match = path.match(owner);
    if (match) return match[0];
  }
  return undefined;
};
