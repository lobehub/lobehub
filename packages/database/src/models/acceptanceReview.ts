import type {
  AcceptanceReview,
  AcceptanceReviewMark,
  AcceptanceReviewMarkInput,
  UpdateAcceptanceReviewMarkInput,
} from '@lobechat/types';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  sql,
  TransactionRollbackError,
} from 'drizzle-orm';

import { acceptanceComments } from '../schemas/acceptanceComment';
import { acceptanceReviewMarks, acceptanceReviews } from '../schemas/acceptanceReview';
import type { LobeChatDatabase } from '../type';

export interface CreateAcceptanceReviewDraftParams {
  projectId?: string | null;
  siteId: string;
  userId: string;
  workspaceId?: string | null;
}

export interface AddAcceptanceReviewMarkParams extends AcceptanceReviewMarkInput {
  screenshotFileId?: string;
}

const isDraft = (reviewId: string) =>
  and(eq(acceptanceReviews.id, reviewId), eq(acceptanceReviews.status, 'draft'));

export class AcceptanceReviewModel {
  constructor(private readonly db: LobeChatDatabase) {}

  createDraft = async (params: CreateAcceptanceReviewDraftParams) => {
    const [row] = await this.db
      .insert(acceptanceReviews)
      .values({
        projectId: params.projectId ?? null,
        siteId: params.siteId,
        status: 'draft',
        userId: params.userId,
        workspaceId: params.workspaceId ?? null,
      })
      .returning();
    return row;
  };

  findById = async (id: string): Promise<AcceptanceReview | undefined> => {
    const [row] = await this.db
      .select()
      .from(acceptanceReviews)
      .where(eq(acceptanceReviews.id, id))
      .limit(1);
    return row;
  };

  findDraft = async (siteId: string, userId: string) => {
    const [row] = await this.db
      .select()
      .from(acceptanceReviews)
      .where(
        and(
          eq(acceptanceReviews.siteId, siteId),
          eq(acceptanceReviews.userId, userId),
          eq(acceptanceReviews.status, 'draft'),
        ),
      )
      .limit(1);
    return row;
  };

  findByTask = async (taskId: string) => {
    const [row] = await this.db
      .select()
      .from(acceptanceReviews)
      .where(eq(acceptanceReviews.taskId, taskId))
      .limit(1);
    return row;
  };

  listSubmitted = async (siteId: string, routeKey?: string) =>
    this.db
      .select()
      .from(acceptanceReviews)
      .where(
        and(
          eq(acceptanceReviews.siteId, siteId),
          eq(acceptanceReviews.status, 'submitted'),
          routeKey === undefined
            ? undefined
            : exists(
                this.db
                  .select({ id: acceptanceReviewMarks.id })
                  .from(acceptanceReviewMarks)
                  .where(
                    and(
                      eq(acceptanceReviewMarks.reviewId, acceptanceReviews.id),
                      eq(acceptanceReviewMarks.routeKey, routeKey),
                    ),
                  ),
              ),
        ),
      )
      .orderBy(desc(acceptanceReviews.submittedAt), desc(acceptanceReviews.createdAt));

  discard = async (reviewId: string) => {
    const [row] = await this.db
      .update(acceptanceReviews)
      .set({ status: 'discarded' })
      .where(isDraft(reviewId))
      .returning();
    if (row)
      await this.db
        .delete(acceptanceReviewMarks)
        .where(eq(acceptanceReviewMarks.reviewId, reviewId));
    return row;
  };

  markSubmitted = async (reviewId: string) => {
    const [row] = await this.db
      .update(acceptanceReviews)
      .set({ status: 'submitted', submittedAt: sql`now()` })
      .where(isDraft(reviewId))
      .returning();
    return row;
  };

  revertToDraft = async (reviewId: string) => {
    const [row] = await this.db
      .update(acceptanceReviews)
      .set({ status: 'draft', submittedAt: null })
      .where(and(eq(acceptanceReviews.id, reviewId), eq(acceptanceReviews.status, 'submitted')))
      .returning();
    return row;
  };

  linkTask = async (reviewId: string, taskId: string) => {
    const [row] = await this.db
      .update(acceptanceReviews)
      .set({ taskId })
      .where(eq(acceptanceReviews.id, reviewId))
      .returning();
    return row;
  };

  addMark = async (
    reviewId: string,
    params: AddAcceptanceReviewMarkParams,
  ): Promise<AcceptanceReviewMark | undefined> => {
    const inserted = await this.db
      .transaction(async (tx) => {
        const [counter] = await tx
          .update(acceptanceReviews)
          .set({ lastMarkSeq: sql`${acceptanceReviews.lastMarkSeq} + 1` })
          .where(isDraft(reviewId))
          .returning({ seq: acceptanceReviews.lastMarkSeq });
        if (!counter) return undefined;

        const [row] = await tx
          .insert(acceptanceReviewMarks)
          .values({
            clientId: params.clientId,
            content: params.content,
            context: params.context,
            kind: params.kind,
            pageMeta: params.pageMeta,
            rectDocument: params.rectDocument,
            rectViewport: params.rectViewport,
            regionRefs: params.regionRefs,
            regions: params.regions,
            reviewId,
            routeKey: params.routeKey,
            screenshotFileId: params.screenshotFileId,
            scroll: params.scroll,
            seq: counter.seq,
            sketch: params.sketch,
            targets: params.targets,
            url: params.url,
            viewport: params.viewport,
          })
          .onConflictDoNothing({
            target: [acceptanceReviewMarks.reviewId, acceptanceReviewMarks.clientId],
          })
          .returning();
        // A retry must not consume a number: rolling back returns the counter bump.
        if (!row) tx.rollback();
        return row;
      })
      .catch((error: unknown) => {
        if (error instanceof TransactionRollbackError) return undefined;
        throw error;
      });
    if (inserted) return inserted;

    const [existing] = await this.db
      .select()
      .from(acceptanceReviewMarks)
      .where(
        and(
          eq(acceptanceReviewMarks.reviewId, reviewId),
          eq(acceptanceReviewMarks.clientId, params.clientId),
        ),
      )
      .limit(1);
    return existing;
  };

  updateMark = async (reviewId: string, markId: string, patch: UpdateAcceptanceReviewMarkInput) => {
    const review = await this.findById(reviewId);
    if (review?.status !== 'draft') return undefined;
    const [row] = await this.db
      .update(acceptanceReviewMarks)
      .set(patch)
      .where(
        and(eq(acceptanceReviewMarks.id, markId), eq(acceptanceReviewMarks.reviewId, reviewId)),
      )
      .returning();
    return row;
  };

  deleteMark = async (reviewId: string, markId: string) => {
    const review = await this.findById(reviewId);
    if (review?.status !== 'draft') return false;
    const deleted = await this.db
      .delete(acceptanceReviewMarks)
      .where(
        and(eq(acceptanceReviewMarks.id, markId), eq(acceptanceReviewMarks.reviewId, reviewId)),
      )
      .returning({ id: acceptanceReviewMarks.id });
    return deleted.length > 0;
  };

  findMark = async (reviewId: string, markId: string) => {
    const [row] = await this.db
      .select()
      .from(acceptanceReviewMarks)
      .where(
        and(eq(acceptanceReviewMarks.id, markId), eq(acceptanceReviewMarks.reviewId, reviewId)),
      )
      .limit(1);
    return row;
  };

  listMarks = async (reviewId: string) =>
    this.db
      .select()
      .from(acceptanceReviewMarks)
      .where(eq(acceptanceReviewMarks.reviewId, reviewId))
      .orderBy(asc(acceptanceReviewMarks.seq));

  countMarks = async (reviewIds: string[]) => {
    if (!reviewIds.length) return new Map<string, number>();
    const rows = await this.db
      .select({ n: count(), reviewId: acceptanceReviewMarks.reviewId })
      .from(acceptanceReviewMarks)
      .where(inArray(acceptanceReviewMarks.reviewId, reviewIds))
      .groupBy(acceptanceReviewMarks.reviewId);
    return new Map(rows.map((row) => [row.reviewId, Number(row.n)]));
  };

  countReplies = async (markIds: string[]) => {
    if (!markIds.length) return new Map<string, number>();
    const rows = await this.db
      .select({ markId: acceptanceComments.reviewMarkId, n: count() })
      .from(acceptanceComments)
      .where(
        and(
          inArray(acceptanceComments.reviewMarkId, markIds),
          isNull(acceptanceComments.deletedAt),
        ),
      )
      .groupBy(acceptanceComments.reviewMarkId);
    return new Map(rows.map((row) => [row.markId ?? '', Number(row.n)]));
  };

  addReply = async (
    acceptanceId: string,
    markId: string,
    params: {
      authorUserId: string;
      clientId: string;
      content: string;
      workspaceId?: string | null;
    },
  ) => {
    await this.db
      .insert(acceptanceComments)
      .values({
        acceptanceId,
        authorUserId: params.authorUserId,
        clientId: params.clientId,
        content: params.content,
        reviewMarkId: markId,
        workspaceId: params.workspaceId ?? null,
      })
      .onConflictDoNothing({
        target: [
          acceptanceComments.acceptanceId,
          acceptanceComments.authorUserId,
          acceptanceComments.clientId,
        ],
      });
    const [row] = await this.db
      .select()
      .from(acceptanceComments)
      .where(
        and(
          eq(acceptanceComments.acceptanceId, acceptanceId),
          eq(acceptanceComments.authorUserId, params.authorUserId),
          eq(acceptanceComments.clientId, params.clientId),
        ),
      )
      .limit(1);
    return row;
  };

  listReplies = async (markId: string) =>
    this.db
      .select()
      .from(acceptanceComments)
      .where(and(eq(acceptanceComments.reviewMarkId, markId), isNull(acceptanceComments.deletedAt)))
      .orderBy(asc(acceptanceComments.createdAt), asc(acceptanceComments.id));

  listReplyIds = async (acceptanceId: string) => {
    const rows = await this.db
      .select({ id: acceptanceComments.id })
      .from(acceptanceComments)
      .where(
        and(
          eq(acceptanceComments.acceptanceId, acceptanceId),
          isNotNull(acceptanceComments.reviewMarkId),
        ),
      );
    return new Set(rows.map((row) => row.id));
  };
}
