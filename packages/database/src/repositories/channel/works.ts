import type {
  CanvasWorkSummaryItem,
  ChannelSharedAgentAccess,
  ExternalWorkSummaryItem,
  WorkSummaryItem,
  WorkType,
} from '@lobechat/types';
import { agentShareWorkAccessScope } from '@lobechat/types';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import pMap from 'p-map';

import { sanitizeVisitorWorks } from '../../models/message/visitor';
import { WorkModel } from '../../models/work';
import { channelJobs, channelMembers, channels, workspaceMembers } from '../../schemas';
import type { Transaction } from '../../type';

const isLinkedExternalWork = (item: WorkSummaryItem): item is ExternalWorkSummaryItem =>
  item.type === 'external' && !!item.url;

const isCanvasWork = (item: WorkSummaryItem): item is CanvasWorkSummaryItem =>
  item.type === 'canvas' && !!item.resourceId;

/**
 * The Works a reply card can open for a shared Agent's visitor: a link, a file by its
 * public `/f/:id` URL, and a collection from the images its summary carries. Documents, canvases
 * and tasks only open through the owner's Work, so they stay out instead of drawing dead cards.
 */
const isVisitorOpenableWork = (item: WorkSummaryItem) =>
  isLinkedExternalWork(item) || item.type === 'file' || item.type === 'collection';

/**
 * The Work types each card actually draws, handed to the summary read so a type that the card
 * then drops cannot spend one of its `limit` slots. Opting into canvases also enables `file` and
 * `collection` (see `OPT_IN_WORK_TYPES`), and a run that saved 20 newer files after its link would
 * otherwise fill the bucket before the cards are filtered, losing the link and the canvas.
 */
const MEMBER_CARD_WORK_TYPES: WorkType[] = ['external', 'canvas'];
const VISITOR_CARD_WORK_TYPES: WorkType[] = ['external', 'file', 'collection'];
const EXTERNAL_ONLY_CARD_WORK_TYPES: WorkType[] = ['external'];

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
  /** The client opens a canvas beside the Channel; older clients would draw a dead card. */
  includeCanvasWorks?: boolean;
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
 * and these resources live outside LobeHub behind their own URL. A canvas is shown to whoever
 * can read it through their own canvas API: the requester, and in a workspace the members when
 * the canvas is not private. Other internal Works (documents, files, collections, tasks) stay
 * off the card, as do the ids that link an external card to the requester's Work, topic and run.
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

  // A workspace member reads the workspace's public canvases; an external contact does not.
  const workspaceId = jobs[0].workspaceId;
  const viewerInWorkspace =
    !!viewer.includeCanvasWorks &&
    !!viewer.userId &&
    !!workspaceId &&
    (
      await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, viewer.userId),
            isNull(workspaceMembers.deletedAt),
          ),
        )
        .limit(1)
    ).length > 0;
  const canOpenCanvas = (item: CanvasWorkSummaryItem, requesterUserId: string) =>
    !!viewer.includeCanvasWorks &&
    (viewer.userId === requesterUserId || (viewerInWorkspace && item.visibility !== 'private'));

  // One read per identity and scope the runs registered their Works under.
  const readers = new Map<
    string,
    { jobs: typeof jobs; model: WorkModel; share: boolean; visitorSeesOwn: boolean }
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
            share: true,
            visitorSeesOwn: viewer.userId === requesterUserId,
          }
        : {
            jobs: [],
            model: new WorkModel(tx, requesterUserId, job.workspaceId ?? undefined),
            share: false,
            visitorSeesOwn: false,
          });
    reader.jobs.push(job);
    readers.set(key, reader);
  }

  await pMap(
    [...readers.values()],
    async ({ jobs: readerJobs, model, share, visitorSeesOwn }) => {
      const summaries = await model.listSummariesByRootOperations({
        // Canvases are an opt-in type; a share run's canvas stays fenced to its visitor topic.
        includeFileWorks: share
          ? visitorSeesOwn && viewer.includeFileWorks
          : viewer.includeCanvasWorks,
        rootOperationIds: readerJobs.map((job) => job.operationId!),
        // Read only what this card can draw, so the types it drops never take a slot.
        types: share
          ? visitorSeesOwn
            ? VISITOR_CARD_WORK_TYPES
            : EXTERNAL_ONLY_CARD_WORK_TYPES
          : MEMBER_CARD_WORK_TYPES,
      });
      for (const job of readerJobs) {
        const runWorks = summaries[job.operationId!] ?? [];
        const cards: WorkSummaryItem[] = visitorSeesOwn
          ? (sanitizeVisitorWorks(runWorks.filter(isVisitorOpenableWork)) ?? [])
          : runWorks.flatMap<WorkSummaryItem>((item): WorkSummaryItem[] => {
              if (isLinkedExternalWork(item)) return [publicSummary(item)];
              if (!share && isCanvasWork(item) && canOpenCanvas(item, job.requesterUserId!))
                return [item];
              return [];
            });
        if (cards.length) result.set(job.messageId!, cards);
      }
    },
    { concurrency: 5 },
  );
  return result;
};
