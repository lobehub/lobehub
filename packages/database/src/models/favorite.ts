import {
  type AddFavoriteParams,
  FAVORITE_LIMIT,
  type FavoriteItem,
  type FavoriteType,
  type TaskStatus,
} from '@lobechat/types';
import { and, asc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';

import { tasks, userFavorites } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { notTrashed } from '../utils/softDelete';
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

const toFavoriteItem = (
  row: typeof userFavorites.$inferSelect,
  status?: string | null,
): FavoriteItem => ({
  icon: row.icon,
  id: row.id,
  path: row.path,
  ...(row.type === 'task' && status ? { status: status as TaskStatus } : {}),
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

  /**
   * Joins a task favorite to its task, in the same scope the favorite lives
   * in and only while the member can still see it, so the sidebar can show
   * the task's current status instead of a snapshot. A deleted, trashed,
   * moved or since-hidden task simply has no status.
   */
  private taskJoin = (): SQL =>
    and(
      eq(userFavorites.type, 'task'),
      eq(tasks.id, userFavorites.targetId),
      notTrashed(tasks.isDeleted),
      this.workspaceId
        ? and(
            eq(tasks.workspaceId, this.workspaceId),
            or(eq(tasks.visibility, 'public'), eq(tasks.createdByUserId, this.userId)),
          )
        : and(isNull(tasks.workspaceId), eq(tasks.createdByUserId, this.userId)),
    ) as SQL;

  query = async (): Promise<FavoriteItem[]> => {
    const rows = await this.db
      .select({ favorite: userFavorites, status: tasks.status })
      .from(userFavorites)
      .leftJoin(tasks, this.taskJoin())
      .where(this.scope())
      .orderBy(asc(userFavorites.sortOrder), asc(userFavorites.createdAt));

    return rows.map((row) => toFavoriteItem(row.favorite, row.status));
  };

  /**
   * Favorite a target, putting it at the top of the section. Favoriting a
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

      // One below the current top. The value may go negative; the next
      // reorder rewrites the whole sidebar to 0..n-1.
      const nextSortOrder = sql<number>`(
        SELECT COALESCE(MIN(${userFavorites.sortOrder}) - 1, 0)
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

      if (row.type !== 'task') return toFavoriteItem(row);

      const [task] = await tx
        .select({ status: tasks.status })
        .from(userFavorites)
        .innerJoin(tasks, this.taskJoin())
        .where(eq(userFavorites.id, row.id))
        .limit(1);

      return toFavoriteItem(row, task?.status);
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
   * favorites missing from `ids` were added after the caller read the list
   * (on another device, or while this reorder waited its turn), so they stay
   * on top, ahead of the listed ones, as {@link add} placed them.
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
        ...existing.filter((id) => !listed.has(id)),
        ...ids.filter((id) => existing.includes(id)),
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
