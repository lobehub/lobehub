import type { ChannelDetail, ChannelPublicJob } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';

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
 * The refusal of a message's reply in a conversation with another person's shared Agent, and
 * the owner it offers to add as a contact. Undefined in any other conversation or when the reply
 * did not fail for a share limit.
 */
export const shareRefusalOf = (
  detail: Pick<ChannelDetail, 'channel' | 'jobs'>,
  messageId: string,
): { errorType: string; ownerId?: string } | undefined => {
  const ownerId = detail.channel.sharedAgentOwnerId;
  if (!ownerId) return;
  const job = (detail.jobs ?? []).find(
    (item) => item.messageId === messageId && isShareRefusal(item),
  );
  if (!job?.errorType) return;
  return {
    errorType: job.errorType,
    ...(SHARE_REFUSALS[job.errorType].addOwner && { ownerId }),
  };
};

export type ContactRequestOutcome = 'added' | 'alreadyContact' | 'requestSent';

/**
 * What asking the owner to be a contact settled as. Undefined for a failure the visitor should
 * see as an error; a conflict means they already reach the owner (a contact or a colleague).
 */
export const contactRequestOutcome = (
  settled: { result: { status: 'accepted' | 'pending' } } | { error: unknown },
): ContactRequestOutcome | undefined => {
  if ('result' in settled) return settled.result.status === 'accepted' ? 'added' : 'requestSent';
  if (settled.error instanceof TRPCClientError && settled.error.data?.code === 'CONFLICT')
    return 'alreadyContact';
};
