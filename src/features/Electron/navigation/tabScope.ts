const FIRST_SEGMENT_REGEX = /^\/([^/?#]+)/;

export const getTabWorkspaceScope = (
  url: string,
  workspaceSlugs: ReadonlySet<string>,
): string | null => {
  const [pathname = '/'] = url.split(/[?#]/);
  const match = pathname.match(FIRST_SEGMENT_REGEX);
  const firstSegment = match?.[1];

  return firstSegment && workspaceSlugs.has(firstSegment) ? firstSegment : null;
};

export const shouldOpenTabForScopeChange = (
  currentTabUrl: string,
  nextUrl: string,
  workspaceSlugs: ReadonlySet<string>,
): boolean =>
  getTabWorkspaceScope(currentTabUrl, workspaceSlugs) !==
  getTabWorkspaceScope(nextUrl, workspaceSlugs);
