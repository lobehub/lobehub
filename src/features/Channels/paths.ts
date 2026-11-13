// An optional leading segment is the workspace slug, then an optional project scope.
const CHANNEL_PATH =
  /^((?:\/[^/]+)?(?:\/project\/[^/]+)?\/channels\/([^/]+))(?:\/settings|\/threads\/([^/]+))?\/?$/;

/** Which Channel a (possibly workspace-prefixed or project-scoped) pathname opens, if any. */
export const matchChannel = (pathname: string): string | undefined =>
  CHANNEL_PATH.exec(pathname)?.[2];

/** The thread a Channel pathname opens as the page (`…/channels/:id/threads/:threadId`), if any. */
export const matchChannelThread = (pathname: string): string | undefined => {
  const threadId = CHANNEL_PATH.exec(pathname)?.[3];
  return threadId && decodeURIComponent(threadId);
};

/** The Channel page a Channel pathname belongs to, keeping its workspace and project prefix. */
export const channelBasePath = (pathname: string): string | undefined =>
  CHANNEL_PATH.exec(pathname)?.[1];
