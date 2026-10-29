/**
 * A Channel page; a thread opens beside its Channel. A project's Channel opens inside the
 * project so its sidebar stays in place.
 */
export const channelPath = (
  channelId: string,
  threadId?: string | null,
  projectId?: string | null,
) => {
  const path = projectId ? `/project/${projectId}/channels/${channelId}` : `/channels/${channelId}`;
  return threadId ? `${path}?thread=${encodeURIComponent(threadId)}` : path;
};

// An optional leading segment is the workspace slug, then an optional project scope.
const CHANNEL_PATH = /^(?:\/[^/]+)?(?:\/project\/[^/]+)?\/channels\/([^/]+)\/?$/;

/** Which Channel a (possibly workspace-prefixed or project-scoped) pathname opens, if any. */
export const matchChannel = (pathname: string): string | undefined =>
  CHANNEL_PATH.exec(pathname)?.[1];
