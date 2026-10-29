import {
  type AddFavoriteParams,
  FAVORITE_LIMIT,
  type FavoriteItem,
  type FavoriteType,
} from '@lobechat/types';
import { and, asc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';

import { userFavorites } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { normalizeWorkspaceId } from '../utils/workspace';

/** Adding another favorite would exceed {@link FAVORITE_LIMIT}. */
export class FavoriteLimitError extends Error {
  constructor() {
    super(`A sidebar holds at most ${FAVORITE_LIMIT} favorites`);
    this.name = 'FavoriteLimitError';
  }
}

export interface UpdateFavoriteParams {
  icon?: string | null;
  path?: string;
  title?: string;
}

const toFavoriteItem = (row: typeof userFavorites.$inferSelect): FavoriteItem => ({
  icon: row.icon,
  id: row.id,
  path: row.path,
  targetId: row.targetId,
  title: row.title,
  type: row.type,
});

/**
 * A member's sidebar favorites. Favorites are personal in every scope: inside
 * a workspace they are still filtered by `user_id`, never shared with other
 * members the way `buildWorkspaceWhere` shares content rows.
 */
export class FavoriteModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId: string | null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = normalizeWorkspaceId(workspaceId);
  }

  private scope = (): SQL =>
    and(
      eq(userFavorites.userId, this.userId),
      this.workspaceId
        ? eq(userFavorites.workspaceId, this.workspaceId)
        : isNull(userFavorites.workspaceId),
    ) as SQL;

  query = async (): Promise<FavoriteItem[]> => {
    const rows = await this.db
      .select()
      .from(userFavorites)
      .where(this.scope())
      .orderBy(asc(userFavorites.sortOrder), asc(userFavorites.createdAt));

    return rows.map(toFavoriteItem);
  };

  /**
   * Favorite a target, appending it to the end of the section. Favoriting a
   * target that is already there refreshes its link and snapshot in place and
   * keeps its position.
   */
  add = async (params: AddFavoriteParams): Promise<FavoriteItem> =>
    // The limit check and the insert run under one per-sidebar lock, so two
    // concurrent adds cannot both see room for one more row.
    this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`user-favorites:${this.userId}:${this.workspaceId ?? 'personal'}`}))`,
      );

      const [{ count, existing }] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          existing: sql<number>`count(*) FILTER (WHERE ${userFavorites.type} = ${params.type} AND ${userFavorites.targetId} = ${params.targetId})::int`,
        })
        .from(userFavorites)
        .where(this.scope());
      // Refreshing an existing favorite never grows the list.
      if (existing === 0 && count >= FAVORITE_LIMIT) throw new FavoriteLimitError();

      const nextSortOrder = sql<number>`(
        SELECT COALESCE(MAX(${userFavorites.sortOrder}) + 1, 0)
        FROM ${userFavorites}
        WHERE ${this.scope()}
      )`;

      const [row] = await tx
        .insert(userFavorites)
        .values({
          icon: params.icon ?? null,
          path: params.path,
          sortOrder: nextSortOrder,
          targetId: params.targetId,
          title: params.title,
          type: params.type,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
        .onConflictDoUpdate({
          set: {
            icon: params.icon ?? null,
            path: params.path,
            title: params.title,
            updatedAt: new Date(),
          },
          target: this.workspaceId
            ? [
                userFavorites.userId,
                userFavorites.workspaceId,
                userFavorites.type,
                userFavorites.targetId,
              ]
            : [userFavorites.userId, userFavorites.type, userFavorites.targetId],
          targetWhere: this.workspaceId
            ? sql`${userFavorites.workspaceId} IS NOT NULL`
            : sql`${userFavorites.workspaceId} IS NULL`,
        })
        .returning();

      return toFavoriteItem(row);
    });

  remove = async (id: string): Promise<void> => {
    await this.db.delete(userFavorites).where(and(eq(userFavorites.id, id), this.scope()));
  };

  removeByTarget = async (type: FavoriteType, targetId: string): Promise<void> => {
    await this.db
      .delete(userFavorites)
      .where(and(eq(userFavorites.type, type), eq(userFavorites.targetId, targetId), this.scope()));
  };

  /**
   * Store the order the member arranged. Ids outside this sidebar are ignored;
   * favorites missing from `ids` keep their position after the listed ones.
   */
  reorder = async (ids: string[]): Promise<void> => {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: userFavorites.id })
        .from(userFavorites)
        .where(this.scope())
        .orderBy(asc(userFavorites.sortOrder), asc(userFavorites.createdAt));

      const existing = rows.map((row) => row.id);
      const listed = new Set(ids);
      const order = [
        ...ids.filter((id) => existing.includes(id)),
        ...existing.filter((id) => !listed.has(id)),
      ];
      if (order.length === 0) return;

      const position = sql.join(
        order.map((id, index) => sql`WHEN ${id} THEN ${index}`),
        sql` `,
      );
      await tx
        .update(userFavorites)
        .set({ sortOrder: sql`(CASE ${userFavorites.id} ${position} END)::integer` })
        .where(and(inArray(userFavorites.id, order), this.scope()));
    });
  };

  update = async (id: string, value: UpdateFavoriteParams): Promise<void> => {
    await this.db
      .update(userFavorites)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(userFavorites.id, id), this.scope()));
  };
}
