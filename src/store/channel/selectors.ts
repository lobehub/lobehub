import type { ChannelJobBlockCode } from '@lobechat/types';

import type { ChannelViewParams } from '@/services/channel';

import { channelViewKey } from './projection';
import type { ChannelState } from './store';

/** These wait for a device or a person rather than for earlier work to finish. */
const EXTERNAL_BLOCKS = new Set<ChannelJobBlockCode>([
  'device_approval_pending',
  'device_offline',
  'unavailable',
  'workspace_changed',
]);

export const channelSelectors = {
  detail: (params: ChannelViewParams) => (state: ChannelState) =>
    state.detailMap[channelViewKey(params)],
  /**
   * Receipt and reply progress must stay live even without gateway notifications. A job
   * blocked on a device or a person does not count.
   */
  hasPendingWork: (params: ChannelViewParams | null) => (state: ChannelState) => {
    const detail = params ? state.detailMap[channelViewKey(params)] : undefined;
    if (!detail) return false;
    return (
      detail.messages.some((message) => message.routingStatus === 'pending') ||
      detail.jobs.some(
        (job) =>
          (job.threadId ?? null) === (params?.threadId ?? null) &&
          (job.writerHeld ||
            (!job.publicationRevoked &&
              ((job.status === 'queued' &&
                !(job.blockedCode && EXTERNAL_BLOCKS.has(job.blockedCode))) ||
                job.status === 'running'))),
      )
    );
  },
  list: (state: ChannelState) => state.listMap.all,
};
