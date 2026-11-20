import { getFileProxyUrl } from '@/server/services/file';

export const createUiMessageFileUrlResolver = () => {
  return async (path: string | null, file: { fileType: string; id?: string | null }) =>
    file.id ? getFileProxyUrl(file.id) : (path ?? '');
};

/**
 * Schema for execAgent - execute a single Agent
 */
/**
 * Whether the calling client declared it handles `member_runtime_end`
 * (`streamFeatures`). Always a boolean for a client-facing route: a client that
 * declares nothing (a released desktop, a stale tab) is a `false` of its own,
 * never "unknown" — only a server-internal continuation, with no caller of its
 * own, inherits the parked operation's declaration.
 */
export const acceptsMemberRuntimeEndOf = (streamFeatures: string[] | undefined): boolean =>
  streamFeatures?.includes('member_runtime_end') ?? false;

/**
 * Whether the calling client declared it renders `file` Works in pushed
 * snapshots (`streamFeatures`). Same boolean contract as
 * {@link acceptsMemberRuntimeEndOf}.
 */
export const acceptsFileWorksOf = (streamFeatures: string[] | undefined): boolean =>
  streamFeatures?.includes('file_works') ?? false;
