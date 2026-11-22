import type {
  ChannelSharedAgentAccess,
  ExternalWorkSummaryItem,
  WorkSummaryItem,
} from '@lobechat/types';
import { agentShareWorkAccessScope } from '@lobechat/types';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import pMap from 'p-map';

import { sanitizeVisitorWorks } from '../../models/message/visitor';
import { WorkModel } from '../../models/work';
import { channelJobs, channelMembers, channels } from '../../schemas';
import type { Transaction } from '../../type';

const isLinkedExternalWork = (item: WorkSummaryItem): item is ExternalWorkSummaryItem =>
  item.type === 'external' && !!item.url;

/**
 * The Works a Channel reply card can open for a shared Agent's visitor: a link, a file by its
 * public `/f/:id` URL, and a collection from the images its summary carries. Documents, canvases
 * and tasks only open through the owner's Work, so they stay out instead of drawing dead cards.
 */
const isVisitorOpenableWork = (item: WorkSummaryItem) =>
  isLinkedExternalWork(item) || item.type === 'file' || item.type === 'collection';

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

export interface ReplyWorksViewer {
  /** The client renders the opt-in Work types (`file`, `collection`, ...); see `OPT_IN_WORK_TYPES`. */
  includeFileWorks?: boolean;
  userId?: string;
}

/**
 * The Works each published reply's run touched, as the work cards the requester's own
 * conversation shows under that run: the same `WorkModel.listSummariesByRootOperations` read,
 * under the identity and scope the run registered them with, keyed by the job's operation.
 *
 * Every member sees the external Works (GitHub, Linear, ...): a reply already shows what it did,
 * and these resources live outside LobeHub behind their own URL. Internal Works (documents,
 * canvases, files, collections, tasks) stay off the card, as do the ids that link a card to the
 * requester's Work, topic and run.
 *
 * A shared Agent's run executes as the Agent's owner and stamps its Works with the visitor's share
 * scope, so they are read as the owner under that scope. The visitor who asked also sees the files
 * and collections, with the owner's identity and spend removed as on the share page; anyone else
 * reading the conversation (its owner, through visitor-conversation access) gets the external
 * ones only.
 */
export const replyWorksByMessage = async (
  tx: Transaction,
  channelId: string,
  messageIds: string[],
  viewer: ReplyWorksViewer = {},
): Promise<Map<string, WorkSummaryItem[]>> => {
  const result = new Map<string, WorkSummaryItem[]>();
  if (!messageIds.length) return result;

  const jobs = await tx
    .select({
      messageId: channelJobs.publishedMessageId,
      operationId: channelJobs.operationId,
      requesterUserId: channelMembers.userId,
      share: sql<ChannelSharedAgentAccess | null>`${channelJobs.executionConfig}->'share'`,
      topicId: channelJobs.topicId,
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

  // One read per identity and scope the runs registered their Works under.
  const readers = new Map<
    string,
    { jobs: typeof jobs; model: WorkModel; visitorSeesOwn: boolean }
  >();
  for (const job of jobs) {
    const requesterUserId = job.requesterUserId!;
    const { share } = job;
    // A share run's Works are fenced to its visitor topic; without one there is nothing to read.
    if (share && !job.topicId) continue;
    const key = share
      ? `share:${share.shareId}:${job.topicId}:${requesterUserId}`
      : `user:${requesterUserId}`;
    const reader =
      readers.get(key) ??
      (share
        ? {
            jobs: [],
            model: new WorkModel(
              tx,
              share.ownerId,
              share.workspaceId ?? undefined,
              agentShareWorkAccessScope({
                shareId: share.shareId,
                topicId: job.topicId!,
                visitorUserId: requesterUserId,
              }),
            ),
            visitorSeesOwn: viewer.userId === requesterUserId,
          }
        : {
            jobs: [],
            model: new WorkModel(tx, requesterUserId, job.workspaceId ?? undefined),
            visitorSeesOwn: false,
          });
    reader.jobs.push(job);
    readers.set(key, reader);
  }

  await pMap(
    [...readers.values()],
    async ({ jobs: readerJobs, model, visitorSeesOwn }) => {
      const summaries = await model.listSummariesByRootOperations({
        includeFileWorks: visitorSeesOwn && viewer.includeFileWorks,
        rootOperationIds: readerJobs.map((job) => job.operationId!),
      });
      for (const job of readerJobs) {
        const runWorks = summaries[job.operationId!] ?? [];
        const cards = visitorSeesOwn
          ? (sanitizeVisitorWorks(runWorks.filter(isVisitorOpenableWork)) ?? [])
          : runWorks.filter(isLinkedExternalWork).map(publicSummary);
        if (cards.length) result.set(job.messageId!, cards);
      }
    },
    { concurrency: 5 },
  );
  return result;
};
