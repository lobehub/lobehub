import type { ChannelDetail, ChannelListItem } from '@lobechat/types';

import { isTrpcErrorCode } from '@/utils/trpcError';

/** Retain content during transport failures, but hide it once access is revoked. */
export const visibleChannelDetail = (cached: ChannelDetail | undefined, error: unknown) =>
  isTrpcErrorCode(error, 'NOT_FOUND') ||
  isTrpcErrorCode(error, 'FORBIDDEN') ||
  isTrpcErrorCode(error, 'UNAUTHORIZED')
    ? undefined
    : cached;

/**
 * Before a conversation's first page arrives, its sidebar row stands in for it, so opening it
 * shows an empty feed and a live input under the listed title instead of a loading placeholder.
 * A thread, an older page, or a failed load has no stand-in.
 */
export const showsListedShell = ({
  before,
  error,
  loaded,
  threadId,
}: {
  before?: number;
  error?: unknown;
  loaded: boolean;
  threadId?: string | null;
}) => !loaded && !error && !threadId && before === undefined;

/**
 * Inviting needs an admin of an open Channel; archived Channels take no new members until
 * reopened. Inviting from a direct conversation starts a new group instead of joining it.
 */
export const canInviteMembers = (channel: Pick<ChannelListItem, 'canDelete' | 'status'>) =>
  channel.canDelete && channel.status !== 'archived';
