import { TRASH_LIST_PAGE_SIZE, TRASH_RETENTION_MS } from '@lobechat/const';
import type {
  TrashCountByType,
  TrashItem,
  TrashItemMeta,
  TrashListParams,
  TrashListResult,
  TrashResourceType,
} from '@lobechat/types';
import { and, asc, count, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import type { NewTrashItemRow, TrashItemRow } from '../schemas';
import { agents, messages, topics, trashItems } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/** Rows per multi-row registry insert — well under Postgres' bind-parameter cap. */
const REGISTER_CHUNK_SIZE = 500;

export interface TrashRegisterEntry {
  meta?: TrashItemMeta | null;
  resourceId: string;
  resourceType: TrashResourceType;
  title?: string | null;
}

export interface TrashRegisterParams {
  /** Rows stamped along with the root; registered under `rootId` and never listed on their own. */
  children?: TrashRegisterEntry[];
  deletedAt: Date;
  /** Defaults to `deletedAt + TRASH_RETENTION_MS`. */
  expiresAt?: Date;
  root: TrashRegisterEntry;
}

/**
 * Source tables for the "does the resource still exist" checks. Purge relies
 * on FK cascades for children, so a root's registry row can be orphaned only
 * when its resource was hard-deleted through a non-trash path — the sweep
 * uses this map to prune those.
 */
const ROOT_TABLES: Record<TrashResourceType, { id: any; isDeleted: any; table: any }> = {
  agent: { id: agents.id, isDeleted: agents.isDeleted, table: agents },
  message: { id: messages.id, isDeleted: messages.isDeleted, table: messages },
  topic: { id: topics.id, isDeleted: topics.isDeleted, table: topics },
};

const toTrashItem = (row: TrashItemRow): TrashItem => ({
  deletedAt: row.deletedAt,
  deletedByUserId: row.deletedByUserId,
  expiresAt: row.expiresAt,
  id: row.id,
  meta: row.meta ?? null,
  resourceId: row.resourceId,
  resourceType: row.resourceType,
  rootId: row.rootId,
  title: row.title,
  userId: row.userId,
  workspaceId: row.workspaceId,
});

/**
 * Registry over trashed rows — see `schemas/trash.ts` for the contract.
 *
 * Scope: personal mode lists the caller's own roots; workspace mode lists
 * every root in the workspace (a member tidying their own agent and an owner
 * tidying a member's both land here — the row records who pressed delete).
 */
export class TrashModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, trashItems);

  // ─────────────────────────── writes ───────────────────────────

  /**
   * Register a root (and its cascaded children) in the bin. Idempotent on the
   * resource: trashing something already registered updates its stamp instead
   * of failing the unique index, so a retried request converges.
   */
  register = async (params: TrashRegisterParams, trx?: Transaction): Promise<TrashItemRow> => {
    const [root] = await this.registerMany(
      {
        cascades: [{ children: params.children, root: params.root }],
        deletedAt: params.deletedAt,
        expiresAt: params.expiresAt,
      },
      trx,
    );
    return root;
  };

  /**
   * Register many roots (each with its cascaded children) sharing one stamp.
   * Rows are written in chunked multi-row statements, so a bulk "clear topics"
   * over hundreds of rows is a handful of round trips instead of one per root
   * inside the caller's transaction. Returns the root rows in input order.
   */
  registerMany = async (
    params: {
      cascades: Pick<TrashRegisterParams, 'children' | 'root'>[];
      deletedAt: Date;
      expiresAt?: Date;
    },
    trx?: Transaction,
  ): Promise<TrashItemRow[]> => {
    if (params.cascades.length === 0) return [];
    const run = async (tx: Transaction | LobeChatDatabase) => {
      const expiresAt =
        params.expiresAt ?? new Date(params.deletedAt.getTime() + TRASH_RETENTION_MS);
      const stamp = {
        deletedAt: params.deletedAt,
        deletedByUserId: this.userId,
        expiresAt,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      };
      const key = (type: string, id: string) => `${type}:${id}`;

      const rootValues: NewTrashItemRow[] = params.cascades.map(({ root }) => ({
        ...stamp,
        meta: root.meta ?? null,
        resourceId: root.resourceId,
        resourceType: root.resourceType,
        rootId: null,
        title: root.title ?? null,
      }));
      const rootsByKey = new Map<string, TrashItemRow>();
      for (let i = 0; i < rootValues.length; i += REGISTER_CHUNK_SIZE) {
        const rows = await tx
          .insert(trashItems)
          .values(rootValues.slice(i, i + REGISTER_CHUNK_SIZE))
          .onConflictDoUpdate({
            set: {
              deletedAt: sql`excluded.deleted_at`,
              deletedByUserId: sql`excluded.deleted_by_user_id`,
              expiresAt: sql`excluded.expires_at`,
              meta: sql`excluded.meta`,
              rootId: sql`NULL`,
              title: sql`excluded.title`,
            },
            target: [trashItems.resourceType, trashItems.resourceId],
          })
          .returning();
        for (const row of rows) rootsByKey.set(key(row.resourceType, row.resourceId), row);
      }

      const childValues: NewTrashItemRow[] = params.cascades.flatMap(({ children, root }) => {
        const rootRow = rootsByKey.get(key(root.resourceType, root.resourceId))!;
        return (children ?? []).map((child) => ({
          ...stamp,
          meta: child.meta ?? null,
          resourceId: child.resourceId,
          resourceType: child.resourceType,
          rootId: rootRow.id,
          title: child.title ?? null,
        }));
      });
      // A child that already has its own registry row (trashed earlier on
      // its own) keeps it: it was in the bin before the root and must stay
      // there after the root is restored. `DO NOTHING` preserves that.
      for (let i = 0; i < childValues.length; i += REGISTER_CHUNK_SIZE) {
        await tx
          .insert(trashItems)
          .values(childValues.slice(i, i + REGISTER_CHUNK_SIZE))
          .onConflictDoNothing({ target: [trashItems.resourceType, trashItems.resourceId] });
      }

      return params.cascades.map(({ root }) =>
        rootsByKey.get(key(root.resourceType, root.resourceId))!,
      );
    };

    return trx ? run(trx) : run(this.db);
  };

  /** Drop registry rows once their resource is restored or purged. Children cascade via `root_id`. */
  removeByIds = async (ids: string[], trx?: Transaction) => {
    if (ids.length === 0) return;
    const db = trx ?? this.db;
    await db.delete(trashItems).where(inArray(trashItems.id, ids));
  };

  /**
   * Drop the roots of topics / messages that were trashed on their own before
   * the agent they belong to (directly or through its legacy session shells),
   * and so kept separate registry rows. Called while that agent is being
   * purged: the FK cascade deletes those resources, so their rows would
   * otherwise linger in the bin pointing at nothing.
   */
  removeRootsUnderAgents = async (
    parents: { agentIds: string[]; sessionIds: string[] },
    trx?: Transaction,
  ) => {
    if (parents.agentIds.length === 0) return;
    const db = trx ?? this.db;
    const topicOwner =
      parents.sessionIds.length > 0
        ? or(
            inArray(topics.agentId, parents.agentIds),
            inArray(topics.sessionId, parents.sessionIds),
          )
        : inArray(topics.agentId, parents.agentIds);
    const ownedTopicIds = db.select({ id: topics.id }).from(topics).where(topicOwner);
    const messageOwner = or(
      inArray(messages.agentId, parents.agentIds),
      parents.sessionIds.length > 0 ? inArray(messages.sessionId, parents.sessionIds) : undefined,
      inArray(messages.topicId, ownedTopicIds),
    );

    await db
      .delete(trashItems)
      .where(
        and(
          this.ownership(),
          isNull(trashItems.rootId),
          or(
            and(
              eq(trashItems.resourceType, 'topic'),
              inArray(trashItems.resourceId, ownedTopicIds),
            ),
            and(
              eq(trashItems.resourceType, 'message'),
              inArray(
                trashItems.resourceId,
                db.select({ id: messages.id }).from(messages).where(messageOwner),
              ),
            ),
          ),
        ),
      );
  };

  removeByResources = async (
    entries: { resourceId: string; resourceType: TrashResourceType }[],
    trx?: Transaction,
  ) => {
    if (entries.length === 0) return;
    const db = trx ?? this.db;
    const byType = new Map<TrashResourceType, string[]>();
    for (const entry of entries) {
      const list = byType.get(entry.resourceType) ?? [];
      list.push(entry.resourceId);
      byType.set(entry.resourceType, list);
    }
    for (const [resourceType, ids] of byType) {
      await db
        .delete(trashItems)
        .where(and(eq(trashItems.resourceType, resourceType), inArray(trashItems.resourceId, ids)));
    }
  };

  // ─────────────────────────── reads ───────────────────────────

  /**
   * Roots in the caller's scope, newest first, keyset-paginated on
   * `(deleted_at, id)`.
   */
  list = async (params: TrashListParams = {}): Promise<TrashListResult> => {
    const limit = Math.min(Math.max(params.limit ?? TRASH_LIST_PAGE_SIZE, 1), 200);
    const cursor = decodeCursor(params.cursor);

    const rows = await this.db
      .select()
      .from(trashItems)
      .where(
        and(
          this.ownership(),
          isNull(trashItems.rootId),
          params.resourceType ? eq(trashItems.resourceType, params.resourceType) : undefined,
          params.deletedByUserId
            ? eq(trashItems.deletedByUserId, params.deletedByUserId)
            : undefined,
          cursor
            ? or(
                lt(trashItems.deletedAt, cursor.deletedAt),
                and(eq(trashItems.deletedAt, cursor.deletedAt), lt(trashItems.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(trashItems.deletedAt), desc(trashItems.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => toTrashItem(row)),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  };

  countByType = async (options?: { deletedByUserId?: string }): Promise<TrashCountByType> => {
    const rows = await this.db
      .select({ resourceType: trashItems.resourceType, total: count() })
      .from(trashItems)
      .where(
        and(
          this.ownership(),
          isNull(trashItems.rootId),
          options?.deletedByUserId
            ? eq(trashItems.deletedByUserId, options.deletedByUserId)
            : undefined,
        ),
      )
      .groupBy(trashItems.resourceType);

    return Object.fromEntries(rows.map((row) => [row.resourceType, row.total]));
  };

  findById = async (id: string): Promise<TrashItemRow | undefined> => {
    return this.db.query.trashItems.findFirst({
      where: and(eq(trashItems.id, id), this.ownership()),
    });
  };

  findByIds = async (ids: string[]): Promise<TrashItemRow[]> => {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(trashItems)
      .where(and(inArray(trashItems.id, ids), this.ownership()));
  };

  findByResource = async (
    resourceType: TrashResourceType,
    resourceId: string,
  ): Promise<TrashItemRow | undefined> => {
    return this.db.query.trashItems.findFirst({
      where: and(
        eq(trashItems.resourceType, resourceType),
        eq(trashItems.resourceId, resourceId),
        this.ownership(),
      ),
    });
  };

  /** Registry rows cascaded under a root (any type). */
  findChildren = async (rootId: string, trx?: Transaction): Promise<TrashItemRow[]> => {
    const db = trx ?? this.db;
    return db.select().from(trashItems).where(eq(trashItems.rootId, rootId));
  };

  /** Every root in scope — used by "empty trash". */
  listAllRootIds = async (options?: {
    /** Restrict to roots this user trashed — a workspace non-owner may only empty their own. */
    deletedByUserId?: string;
    /** Cap the ids returned — empty-trash works one bounded batch per request. */
    limit?: number;
    resourceType?: TrashResourceType;
  }): Promise<string[]> => {
    const query = this.db
      .select({ id: trashItems.id })
      .from(trashItems)
      .where(
        and(
          this.ownership(),
          isNull(trashItems.rootId),
          options?.resourceType ? eq(trashItems.resourceType, options.resourceType) : undefined,
          options?.deletedByUserId
            ? eq(trashItems.deletedByUserId, options.deletedByUserId)
            : undefined,
        ),
      )
      .orderBy(asc(trashItems.deletedAt), asc(trashItems.id));
    const rows = await (options?.limit ? query.limit(options.limit) : query);
    return rows.map((row) => row.id);
  };

  // ─────────────────────────── sweep (global, not user-scoped) ───────────────────────────

  /**
   * Expired roots across every user, oldest first. The purge sweep instantiates
   * a per-owner service for each so hard deletes run under the right scope.
   */
  static listExpiredRoots = async (
    db: LobeChatDatabase,
    params: { limit: number; now?: Date },
  ): Promise<TrashItemRow[]> => {
    const now = params.now ?? new Date();
    return db
      .select()
      .from(trashItems)
      .where(and(isNull(trashItems.rootId), lte(trashItems.expiresAt, now)))
      .orderBy(asc(trashItems.expiresAt), asc(trashItems.id))
      .limit(params.limit);
  };

  /**
   * Drop root registry rows whose resource no longer exists (hard-deleted
   * through a non-trash path — a user purge, an FK cascade from a parent that
   * was itself purged, …) or is no longer stamped (restored through a
   * non-trash path). Returns how many were pruned.
   */
  static pruneOrphans = async (db: LobeChatDatabase): Promise<number> => {
    let pruned = 0;
    for (const [resourceType, source] of Object.entries(ROOT_TABLES) as [
      TrashResourceType,
      (typeof ROOT_TABLES)[TrashResourceType],
    ][]) {
      const result = await db
        .delete(trashItems)
        .where(
          and(
            eq(trashItems.resourceType, resourceType),
            isNull(trashItems.rootId),
            sql`NOT EXISTS (SELECT 1 FROM ${source.table} WHERE ${source.id} = ${trashItems.resourceId} AND ${source.isDeleted} = true)`,
          ),
        )
        .returning({ id: trashItems.id });
      pruned += result.length;
    }
    return pruned;
  };
}

// keyset cursor: base64url of `<deletedAt ms>:<id>`
const encodeCursor = (row: Pick<TrashItemRow, 'deletedAt' | 'id'>) =>
  Buffer.from(`${row.deletedAt.getTime()}:${row.id}`).toString('base64url');

const decodeCursor = (cursor?: string | null): { deletedAt: Date; id: string } | null => {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = raw.indexOf(':');
    if (idx < 0) return null;
    const ms = Number(raw.slice(0, idx));
    const id = raw.slice(idx + 1);
    if (!Number.isFinite(ms) || !id) return null;
    return { deletedAt: new Date(ms), id };
  } catch {
    return null;
  }
};
