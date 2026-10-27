/** A Channel page; a thread opens beside its Channel. */
export const channelPath = (channelId: string, threadId?: string | null) => {
  const path = `/channels/${channelId}`;
  return threadId ? `${path}?thread=${encodeURIComponent(threadId)}` : path;
};

// An optional leading segment is the workspace slug.
const CHANNEL_PATH = /^(?:\/[^/]+)?\/channels\/([^/]+)\/?$/;

/** Which Channel a (possibly workspace-prefixed) pathname opens, if any. */
export const matchChannel = (pathname: string): string | undefined =>
  CHANNEL_PATH.exec(pathname)?.[1];
