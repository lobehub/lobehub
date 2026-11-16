import type { QueuedFollowUpWaitReason } from '@lobechat/types';

import { FileModel } from '@/database/models/file';
import type { LobeChatDatabase } from '@/database/type';
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

/** File type of each attached file the caller can read, by file id. */
export type AttachmentTypes = ReadonlyMap<string, string>;

/**
 * Look up the type of every file attached to `entries`, so
 * {@link heteroSteerHoldReason} can tell image attachments from documents.
 * One indexed read, without signing URLs: the run asks on every poll.
 */
export const loadAttachmentTypes = async (
  ctx: { db: LobeChatDatabase; userId: string; workspaceId?: string | null },
  entries: Pick<QueuedFollowUp, 'request'>[],
): Promise<AttachmentTypes> => {
  const fileIds = [...new Set(entries.flatMap((entry) => entry.request.fileIds ?? []))];
  if (fileIds.length === 0) return new Map();

  const files = await new FileModel(ctx.db, ctx.userId, ctx.workspaceId ?? undefined).findByIds(
    fileIds,
  );
  return new Map(files.map((file) => [file.id, file.fileType ?? '']));
};

const isImageType = (fileType: string | undefined) => !!fileType?.startsWith('image');

/**
 * Why a follow-up cannot be typed into the running agent session, or
 * `undefined` when it can: text for the same agent, with images attached or
 * pasted in. Other attachments (a document is parsed into the prompt of a turn
 * of its own), attached selections, tool or skill selections and @-mentions
 * need a turn configured for them, and wait for the run to end. Pasted images
 * go in only when the session takes image input (`acceptsImages`), attached
 * ones only when the producer also handles them (`acceptsAttachedImages`).
 *
 * Attached files count as images only when `attachmentTypes` names every one
 * as an image; a file it does not know (unreadable, or not looked up) holds.
 */
export const heteroSteerHoldReason = (
  entry: Pick<QueuedFollowUp, 'request'>,
  params: {
    acceptsAttachedImages?: boolean;
    acceptsImages?: boolean;
    agentId: string | null;
    attachmentTypes?: AttachmentTypes;
  },
): QueuedFollowUpWaitReason | undefined => {
  const { request } = entry;
  const fileIds = request.fileIds ?? [];
  if (fileIds.some((id) => !isImageType(params.attachmentTypes?.get(id)))) return 'attachments';
  if (!request.prompt.trim()) return 'empty';
  if (request.userMessage?.metadata) return 'selection';
  if (request.selectedToolIds?.length || request.selectedSkillIds?.length) return 'toolSelection';
  if (request.mentionedAgents?.length) return 'mentions';
  if (!params.agentId || request.agentId !== params.agentId) return 'otherAgent';
  if (fileIds.length > 0 && !params.acceptsAttachedImages) return 'imagesNeedNewerCli';
  if (!params.acceptsImages && collectMarkdownImageUrls(request.prompt).length > 0)
    return 'imagesNeedNewerCli';
};
