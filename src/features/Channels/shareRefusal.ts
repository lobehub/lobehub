import type { ChannelDetail, ChannelPublicJob, ContactUserProfile } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';

/**
 * The share refusals a visitor reads beside their message instead of behind a failure mark,
 * since the reply will never come; each names what the visitor can do next. Running out of
 * messages or of the share's monthly usage is the owner's limit, so the visitor may ask the
 * owner directly: as a contact, they can message them in their own conversation.
 */
const SHARE_REFUSALS: Record<string, { addOwner: boolean }> = {
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
 * The refusal of a message's reply in a conversation with another person's shared Agent, and
 * the owner whose contact card it offers. Undefined in any other conversation or when the reply
 * did not fail for a share limit.
 */
export const shareRefusalOf = (
  detail: Pick<ChannelDetail, 'jobs' | 'sharedAgentOwner'>,
  messageId: string,
): { errorType: string; owner?: ContactUserProfile } | undefined => {
  const owner = detail.sharedAgentOwner;
  if (!owner) return;
  const job = (detail.jobs ?? []).find(
    (item) => item.messageId === messageId && isShareRefusal(item),
  );
  if (!job?.errorType) return;
  return {
    errorType: job.errorType,
    ...(SHARE_REFUSALS[job.errorType].addOwner && { owner }),
  };
};
