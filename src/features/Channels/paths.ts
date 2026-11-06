// An optional leading segment is the workspace slug, then an optional project scope.
const CHANNEL_PATH = /^(?:\/[^/]+)?(?:\/project\/[^/]+)?\/channels\/([^/]+)\/?$/;

/** Which Channel a (possibly workspace-prefixed or project-scoped) pathname opens, if any. */
export const matchChannel = (pathname: string): string | undefined =>
  CHANNEL_PATH.exec(pathname)?.[1];
