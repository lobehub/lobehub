import type { ChannelDetail, ChannelPublicJob, ContactUserProfile } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';

/**
 * The share refusals a visitor reads beside their message instead of behind a failure mark,
 * since the reply will never come; each names what the visitor can do next. Running out of
 * messages, of the share's attachment storage or of its monthly usage is the owner's limit, and running an Agent on the
 * owner's own machine needs the owner's permission, so the visitor may ask the owner directly:
 * as a contact, they can message them in their own conversation. Running out of the funds for
 * visitor replies is lifted by a tip, which the visitor can give themselves.
 */
const SHARE_REFUSALS: Record<string, { addOwner: boolean; tip?: boolean }> = {
  [ChatErrorType.ShareAttachmentTooLarge]: { addOwner: false },
  [ChatErrorType.ShareFileStorageExceeded]: { addOwner: true },
  [ChatErrorType.ShareFundingExhausted]: { addOwner: false, tip: true },
  [ChatErrorType.ShareHeterogeneousAgentUnsupported]: { addOwner: true },
  [ChatErrorType.ShareMessageLimitExceeded]: { addOwner: true },
  [ChatErrorType.SharePromptTooLong]: { addOwner: false },
  [ChatErrorType.ShareSpendLimitExceeded]: { addOwner: true },
};

export const isShareRefusal = (job: Pick<ChannelPublicJob, 'errorType' | 'status'>) =>
  job.status === 'failed' && !!job.errorType && Object.hasOwn(SHARE_REFUSALS, job.errorType);

/**
 * Replies a conversation shows as cards, without the share refusals its request explains below
 * itself (`ShareRefusalNotice`), so one refusal never reads twice.
 */
export const withoutShareRefusals = <Job extends Pick<ChannelPublicJob, 'errorType' | 'status'>>(
  detail: Pick<ChannelDetail, 'sharedAgentOwner'>,
  jobs: Job[],
) => (detail.sharedAgentOwner ? jobs.filter((job) => !isShareRefusal(job)) : jobs);

/**
 * The refusal of a message's reply in a conversation with another person's shared Agent, the
 * owner whose contact card it offers, and the Agent a visitor can tip when a tip lifts it.
 * Undefined in any other conversation or when the reply did not fail for a share limit.
 */
export const shareRefusalOf = (
  detail: Pick<ChannelDetail, 'jobs' | 'sharedAgentOwner'> & {
    channel: Pick<ChannelDetail['channel'], 'agentId'>;
  },
  messageId: string,
): { errorType: string; owner?: ContactUserProfile; tipAgentId?: string } | undefined => {
  const owner = detail.sharedAgentOwner;
  if (!owner) return;
  const job = (detail.jobs ?? []).find(
    (item) => item.messageId === messageId && isShareRefusal(item),
  );
  if (!job?.errorType) return;
  const refusal = SHARE_REFUSALS[job.errorType];
  const tipAgentId = refusal.tip ? detail.channel.agentId : undefined;
  return {
    errorType: job.errorType,
    ...(refusal.addOwner && { owner }),
    ...(tipAgentId && { tipAgentId }),
  };
};
