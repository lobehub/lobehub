import type { ChannelDetail } from '@lobechat/types';

import { isTrpcErrorCode } from '@/utils/trpcError';

/** Retain content during transport failures, but hide it once access is revoked. */
export const visibleChannelDetail = (cached: ChannelDetail | undefined, error: unknown) =>
  isTrpcErrorCode(error, 'NOT_FOUND') ||
  isTrpcErrorCode(error, 'FORBIDDEN') ||
  isTrpcErrorCode(error, 'UNAUTHORIZED')
    ? undefined
    : cached;
