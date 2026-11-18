import type { ExternalWorkSummaryItem, WorkSummaryItem } from '@lobechat/types';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import pMap from 'p-map';

import { WorkModel } from '../../models/work';
import { channelJobs, channelMembers, channels } from '../../schemas';
import type { Transaction } from '../../type';

const isLinkedExternalWork = (item: WorkSummaryItem): item is ExternalWorkSummaryItem =>
  item.type === 'external' && !!item.url;

/**
 * A summary as other members see it: what the card draws, without the ids that tie it to the
 * requester's Work, conversation and run. The URL keys the card in place of the Work id.
 */
const publicSummary = (item: ExternalWorkSummaryItem): ExternalWorkSummaryItem => ({
  ...item,
  currentVersionId: null,
  event: { ...item.event, id: '', messageId: null, rootOperationId: null, toolCallId: null },
  id: item.url!,
  originAgentId: null,
  originThreadId: null,
  originTopicId: null,
  userId: '',
  version: null,
  workspaceId: null,
});

/**
 * The external Works (GitHub, Linear, ...) each published reply's run touched, as the work cards
 * the requester's own conversation shows under that run: the same
 * `WorkModel.listSummariesByRootOperations` read, as the requester, keyed by the job's operation.
 *
 * Every member sees them: a reply already shows what it did, and these resources live outside
 * LobeHub behind their own URL. Internal Works (documents, canvases, files, tasks) stay with the
 * requester, as do the ids that link a card to the requester's Work, topic and run.
 */
export const externalWorksByMessage = async (
  tx: Transaction,
  channelId: string,
  messageIds: string[],
): Promise<Map<string, ExternalWorkSummaryItem[]>> => {
  const result = new Map<string, ExternalWorkSummaryItem[]>();
  if (!messageIds.length) return result;

  const jobs = await tx
    .select({
      messageId: channelJobs.publishedMessageId,
      operationId: channelJobs.operationId,
      requesterUserId: channelMembers.userId,
      workspaceId: channels.workspaceId,
    })
    .from(channelJobs)
    .innerJoin(channels, eq(channels.id, channelJobs.channelId))
    .innerJoin(
      channelMembers,
      and(
        eq(channelMembers.channelId, channelJobs.channelId),
        eq(channelMembers.id, channelJobs.requesterMemberId),
      ),
    )
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        inArray(channelJobs.publishedMessageId, messageIds),
        isNotNull(channelJobs.operationId),
        isNotNull(channelMembers.userId),
      ),
    );
  if (!jobs.length) return result;

  // The run is the requester's, so its Works are read the way their own conversation reads them.
  const byRequester = new Map<string, typeof jobs>();
  for (const job of jobs)
    byRequester.set(job.requesterUserId!, [...(byRequester.get(job.requesterUserId!) ?? []), job]);
  await pMap(
    [...byRequester],
    async ([userId, requesterJobs]) => {
      const summaries = await new WorkModel(
        tx,
        userId,
        requesterJobs[0].workspaceId ?? undefined,
      ).listSummariesByRootOperations({
        rootOperationIds: requesterJobs.map((job) => job.operationId!),
      });
      for (const job of requesterJobs) {
        const cards = (summaries[job.operationId!] ?? [])
          .filter(isLinkedExternalWork)
          .map(publicSummary);
        if (cards.length) result.set(job.messageId!, cards);
      }
    },
    { concurrency: 5 },
  );
  return result;
};
