import type { QueuedFollowUpWaitReason } from '@lobechat/types';

import { collectMarkdownImageUrls } from '@/server/services/file/inlineImages';

import type { QueuedFollowUp } from './index';

/**
 * Kept apart from `./hetero` so the queue list (which only explains the
 * queue) can use it without loading the delivery path and its run guards.
 */

/** Why the run's producer holds a queued follow-up back, reported once per change. */
export interface HeteroSteerHold {
  entryId: string;
  reason: QueuedFollowUpWaitReason;
}

/**
 * Why a follow-up cannot be typed into the running agent session, or
 * `undefined` when it can: plain text for the same agent. Attachments,
 * attached selections, tool or skill selections and @-mentions need a turn
 * configured for them, and wait for the run to end. Pasted images go in only
 * when the session takes image input (`acceptsImages`); decided from the
 * markdown alone, since the run asks again on every poll.
 */
export const heteroSteerHoldReason = (
  entry: Pick<QueuedFollowUp, 'request'>,
  params: { acceptsImages?: boolean; agentId: string | null },
): QueuedFollowUpWaitReason | undefined => {
  const { request } = entry;
  if (request.fileIds?.length) return 'attachments';
  if (!request.prompt.trim()) return 'empty';
  if (request.userMessage?.metadata) return 'selection';
  if (request.selectedToolIds?.length || request.selectedSkillIds?.length) return 'toolSelection';
  if (request.mentionedAgents?.length) return 'mentions';
  if (!params.agentId || request.agentId !== params.agentId) return 'otherAgent';
  if (!params.acceptsImages && collectMarkdownImageUrls(request.prompt).length > 0)
    return 'imagesNeedNewerCli';
};
