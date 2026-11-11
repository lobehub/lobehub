import type { AcceptanceReviewMarkInput, UpdateAcceptanceReviewMarkInput } from '@lobechat/types';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { acceptanceComments } from '../schemas/acceptanceComment';
import type { AcceptanceReviewMarkRow, AcceptanceReviewRow } from '../schemas/acceptanceReview';
import { acceptanceReviewMarks, acceptanceReviews } from '../schemas/acceptanceReview';
import type { LobeChatDatabase } from '../type';

export interface CreateAcceptanceReviewDraftParams {
  acceptanceId: string;
  authorUserId: string;
  pageTitle?: string;
  pageUrl: string;
  projectId?: string | null;
  route: string;
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
        acceptanceId: params.acceptanceId,
        authorUserId: params.authorUserId,
        pageTitle: params.pageTitle,
        pageUrl: params.pageUrl,
        projectId: params.projectId ?? null,
        route: params.route,
        status: 'draft',
        workspaceId: params.workspaceId ?? null,
      })
      .returning();
    return row;
  };

  findById = async (id: string): Promise<AcceptanceReviewRow | undefined> => {
    const [row] = await this.db
      .select()
      .from(acceptanceReviews)
      .where(eq(acceptanceReviews.id, id))
      .limit(1);
    return row;
  };

  findDraft = async (acceptanceId: string, authorUserId: string) => {
    const [row] = await this.db
      .select()
      .from(acceptanceReviews)
      .where(
        and(
          eq(acceptanceReviews.acceptanceId, acceptanceId),
          eq(acceptanceReviews.authorUserId, authorUserId),
          eq(acceptanceReviews.status, 'draft'),
        ),
      )
      .limit(1);
    return row;
  };

  findByDeliveryAcceptance = async (deliveryAcceptanceId: string) => {
    const [row] = await this.db
      .select()
      .from(acceptanceReviews)
      .where(eq(acceptanceReviews.deliveryAcceptanceId, deliveryAcceptanceId))
      .limit(1);
    return row;
  };

  listSubmitted = async (acceptanceId: string, route?: string) =>
    this.db
      .select()
      .from(acceptanceReviews)
      .where(
        and(
          eq(acceptanceReviews.acceptanceId, acceptanceId),
          eq(acceptanceReviews.status, 'submitted'),
          route === undefined ? undefined : eq(acceptanceReviews.route, route),
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

  markSubmitted = async (
    reviewId: string,
    params: { agentId?: string | null; summary?: string | null; title: string },
  ) => {
    const [row] = await this.db
      .update(acceptanceReviews)
      .set({
        agentId: params.agentId ?? null,
        status: 'submitted',
        submittedAt: new Date(),
        summary: params.summary ?? null,
        title: params.title,
      })
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

  linkDelivery = async (
    reviewId: string,
    params: { deliveryAcceptanceId?: string | null; taskId?: string | null },
  ) => {
    const [row] = await this.db
      .update(acceptanceReviews)
      .set({
        ...(params.deliveryAcceptanceId !== undefined
          ? { deliveryAcceptanceId: params.deliveryAcceptanceId }
          : {}),
        ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
      })
      .where(eq(acceptanceReviews.id, reviewId))
      .returning();
    return row;
  };

  addMark = async (
    reviewId: string,
    params: AddAcceptanceReviewMarkParams,
  ): Promise<AcceptanceReviewMarkRow> =>
    this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(acceptanceReviewMarks)
        .where(
          and(
            eq(acceptanceReviewMarks.reviewId, reviewId),
            eq(acceptanceReviewMarks.clientId, params.clientId),
          ),
        )
        .limit(1);
      if (existing) return existing;

      const [counter] = await tx
        .update(acceptanceReviews)
        .set({ lastMarkSeq: sql`${acceptanceReviews.lastMarkSeq} + 1` })
        .where(eq(acceptanceReviews.id, reviewId))
        .returning({ seq: acceptanceReviews.lastMarkSeq });
      if (!counter) throw new Error(`Review "${reviewId}" not found`);

      const [row] = await tx
        .insert(acceptanceReviewMarks)
        .values({
          clientId: params.clientId,
          content: params.content,
          context: params.context,
          kind: params.kind,
          pageUrl: params.pageUrl,
          rectDocument: params.rectDocument,
          rectViewport: params.rectViewport,
          regionRefs: params.regionRefs,
          regions: params.regions,
          reviewId,
          route: params.route,
          screenshotFileId: params.screenshotFileId,
          scroll: params.scroll,
          seq: counter.seq,
          sketch: params.sketch,
          targets: params.targets,
          viewport: params.viewport,
        })
        .returning();
      return row;
    });

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
