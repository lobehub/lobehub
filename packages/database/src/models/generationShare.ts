import type { ShareVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { generationBatches, generations, generationShares, generationTopics } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { notTrashed } from '../utils/softDelete';
import { buildWorkspaceWhere } from '../utils/workspace';

export type GenerationShareData = NonNullable<
  Awaited<ReturnType<(typeof GenerationShareModel)['findByShareId']>>
>;

/**
 * Public share links for one generation result.
 *
 * Only the generation's creator manages its link: a workspace-public generation
 * is readable by every member, but posting it to the open web is the creator's
 * call, the same rule the topic's workspace visibility already follows.
 */
export class GenerationShareModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  /** The scope the share row lives in, plus the creator check. */
  private ownership = () =>
    and(
      eq(generationShares.userId, this.userId),
      this.workspaceId
        ? eq(generationShares.workspaceId, this.workspaceId)
        : isNull(generationShares.workspaceId),
    );

  /** The generation, if the current user created it in the current scope and it is not trashed. */
  private findOwnGeneration = async (generationId: string) => {
    const [generation] = await this.db
      .select({ id: generations.id, userId: generations.userId })
      .from(generations)
      .where(
        and(
          eq(generations.id, generationId),
          eq(generations.userId, this.userId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, generations),
          notTrashed(generations.isDeleted),
        ),
      )
      .limit(1);

    return generation ?? null;
  };

  /**
   * Create the share for a generation, or return the existing one (one share
   * per generation, enforced by a unique index).
   */
  create = async (generationId: string, visibility: ShareVisibility = 'private') => {
    const generation = await this.findOwnGeneration(generationId);
    if (!generation) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Generation not found' });
    }

    const [result] = await this.db
      .insert(generationShares)
      .values({
        generationId,
        userId: generation.userId,
        visibility,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoNothing({ target: generationShares.generationId })
      .returning();

    return result ?? this.getByGenerationId(generationId);
  };

  updateVisibility = async (generationId: string, visibility: ShareVisibility) => {
    const [result] = await this.db
      .update(generationShares)
      .set({ updatedAt: new Date(), visibility })
      .where(and(eq(generationShares.generationId, generationId), this.ownership()))
      .returning();

    return result ?? null;
  };

  /**
   * Create-or-update in one statement: the share id the link uses afterwards.
   *
   * An atomic upsert, not read-then-write: two first-time changes racing (link
   * on, link off) would otherwise both see "no share", both insert, and the
   * loser would report success while the row keeps the winner's visibility —
   * possibly leaving a link public after the owner turned it off. With the
   * upsert every call applies its own value and the last one wins.
   */
  setVisibility = async (generationId: string, visibility: ShareVisibility) => {
    const generation = await this.findOwnGeneration(generationId);
    if (!generation) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Generation not found' });
    }

    const [result] = await this.db
      .insert(generationShares)
      .values({
        generationId,
        userId: generation.userId,
        visibility,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoUpdate({
        set: { updatedAt: new Date(), visibility },
        target: generationShares.generationId,
        // Only the owner's own row in this scope; never adopt someone else's.
        where: this.ownership(),
      })
      .returning();

    return result ?? null;
  };

  /** The owner's view of the share, or null when the generation has never been shared. */
  getByGenerationId = async (generationId: string) => {
    const [result] = await this.db
      .select({
        generationId: generationShares.generationId,
        id: generationShares.id,
        pageViewCount: generationShares.pageViewCount,
        userId: generationShares.userId,
        visibility: generationShares.visibility,
      })
      .from(generationShares)
      .where(and(eq(generationShares.generationId, generationId), this.ownership()))
      .limit(1);

    return result ?? null;
  };

  /**
   * Resolve a share link with no user scope (that is the point of a public
   * link), so it carries the recycle-bin gate itself on every joined row: a
   * trashed generation, batch or topic keeps its share row until purge.
   */
  static findByShareId = async (db: LobeChatDatabase, shareId: string) => {
    const [result] = await db
      .select({
        asset: generations.asset,
        createdAt: generations.createdAt,
        generationId: generations.id,
        model: generationBatches.model,
        ownerId: generationShares.userId,
        pageViewCount: generationShares.pageViewCount,
        prompt: generationBatches.prompt,
        provider: generationBatches.provider,
        shareId: generationShares.id,
        topicTitle: generationTopics.title,
        type: generationTopics.type,
        visibility: generationShares.visibility,
        workspaceId: generationShares.workspaceId,
      })
      .from(generationShares)
      .innerJoin(
        generations,
        and(eq(generationShares.generationId, generations.id), notTrashed(generations.isDeleted)),
      )
      .innerJoin(
        generationBatches,
        and(
          eq(generations.generationBatchId, generationBatches.id),
          notTrashed(generationBatches.isDeleted),
        ),
      )
      .innerJoin(
        generationTopics,
        and(
          eq(generationBatches.generationTopicId, generationTopics.id),
          notTrashed(generationTopics.isDeleted),
        ),
      )
      .where(eq(generationShares.id, shareId))
      .limit(1);

    return result ?? null;
  };

  static incrementPageViewCount = async (db: LobeChatDatabase, shareId: string) => {
    await db
      .update(generationShares)
      .set({ pageViewCount: sql`${generationShares.pageViewCount} + 1` })
      .where(eq(generationShares.id, shareId));
  };

  /**
   * Resolve a share link for a visitor. 'private' is readable by the owner
   * only; 'link' by anyone. Throws NOT_FOUND / FORBIDDEN otherwise.
   */
  static findByShareIdWithAccessCheck = async (
    db: LobeChatDatabase,
    shareId: string,
    accessUserId?: string,
  ): Promise<GenerationShareData> => {
    const share = await GenerationShareModel.findByShareId(db, shareId);

    if (!share || !share.asset) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
    }

    const isOwner = !!accessUserId && share.ownerId === accessUserId;
    if (!isOwner && share.visibility !== 'link') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    return share;
  };
}
