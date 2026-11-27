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
 * Any member of an open Channel may invite; archived Channels take no new members until
 * reopened. Inviting from a direct conversation starts a new group instead of joining it.
 */
export const canInviteMembers = (
  channel: Pick<ChannelListItem, 'canDelete' | 'canInvite' | 'status'>,
) => (channel.canInvite ?? channel.canDelete) && channel.status !== 'archived';
