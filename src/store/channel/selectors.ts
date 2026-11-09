import type { ChannelJobBlockCode, ChannelReplyJob } from '@lobechat/types';

import type { ChannelViewParams } from '@/services/channel';

import { channelOutboxKey, type ChannelOutgoingMessage } from './outbox';
import { channelViewKey } from './projection';
import type { ChannelState } from './store';

const NO_OUTGOING: ChannelOutgoingMessage[] = [];

/** These wait for a device or a person rather than for earlier work to finish. */
const EXTERNAL_BLOCKS = new Set<ChannelJobBlockCode>([
  'device_approval_pending',
  'device_offline',
  'device_required',
  'unavailable',
  'workspace_changed',
]);

/** Still progressing on its own, so a view showing it must refresh soon. */
const isProgressing = (job: ChannelReplyJob) =>
  job.writerHeld ||
  (!job.publicationRevoked &&
    ((job.status === 'queued' && !(job.blockedCode && EXTERNAL_BLOCKS.has(job.blockedCode))) ||
      job.status === 'running'));

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
        (job) => (job.threadId ?? null) === (params?.threadId ?? null) && isProgressing(job),
      )
    );
  },
  /** The caller's direct conversation with an Agent; a direct Channel never belongs to a project. */
  directByAgent: (agentId: string) => (state: ChannelState) =>
    state.listMap.all?.find((channel) => channel.agentId === agentId && !channel.projectId),
  list: (state: ChannelState) => state.listMap.all,
  /** A listed conversation has a reply in progress, which its row shows until it settles. */
  listHasPendingWork: (state: ChannelState) =>
    !!state.listMap.all?.some((channel) => channel.replyJobs?.some(isProgressing)),
  /** This tab's messages for one conversation that its loaded pages do not hold yet. */
  outgoing: (channelId: string, threadId?: string | null) => (state: ChannelState) =>
    state.outbox[channelOutboxKey(channelId, threadId)] ?? NO_OUTGOING,
};
