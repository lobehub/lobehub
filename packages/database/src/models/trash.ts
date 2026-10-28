import { TRASH_LIST_PAGE_SIZE, TRASH_RETENTION_MS } from '@lobechat/const';
import type {
  TrashCountByType,
  TrashItem,
  TrashItemMeta,
  TrashListParams,
  TrashListResult,
  TrashResourceType,
  TrashRootFilter,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, count, desc, eq, inArray, isNull, lt, lte, not, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { NewTrashItemRow, TrashItemRow } from '../schemas';
import {
  agents,
  channels,
  channelThreads,
  chatGroups,
  dashboards,
  messages,
  projects,
  topics,
  trashItems,
  widgets,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/** Rows per multi-row registry insert — well under Postgres' bind-parameter cap. */
const REGISTER_CHUNK_SIZE = 500;

export interface TrashRegisterEntry {
  meta?: TrashItemMeta | null;
  projectId: string | null;
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
  channel: { id: channels.id, isDeleted: channels.isDeleted, table: channels },
  channelThread: {
    id: channelThreads.id,
    isDeleted: channelThreads.isDeleted,
    table: channelThreads,
  },
  dashboard: { id: dashboards.id, isDeleted: dashboards.isDeleted, table: dashboards },
  message: { id: messages.id, isDeleted: messages.isDeleted, table: messages },
  topic: { id: topics.id, isDeleted: topics.isDeleted, table: topics },
  widget: { id: widgets.id, isDeleted: widgets.isDeleted, table: widgets },
};

const privateAgent = (id: AnyPgColumn) =>
  sql`EXISTS (SELECT 1 FROM ${agents} WHERE ${agents.id} = ${id} AND ${agents.visibility} = 'private')`;
const privateGroup = (id: AnyPgColumn) =>
  sql`EXISTS (SELECT 1 FROM ${chatGroups} WHERE ${chatGroups.id} = ${id} AND ${chatGroups.visibility} = 'private')`;
const privateProject = (id: AnyPgColumn) =>
  sql`EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.id} = ${id} AND ${projects.visibility} = 'private')`;

/** A topic is private when its agent, group or project is. */
const privateTopic = (id: AnyPgColumn) =>
  sql`EXISTS (SELECT 1 FROM ${topics} WHERE ${topics.id} = ${id} AND (${privateAgent(topics.agentId)} OR ${privateGroup(topics.groupId)} OR ${privateProject(topics.projectId)}))`;

/** A channel is private to its members, or when its agent or project is private. */
const privateChannel = (id: AnyPgColumn) =>
  sql`EXISTS (SELECT 1 FROM ${channels} WHERE ${channels.id} = ${id} AND (${channels.visibility} = 'private' OR ${privateAgent(channels.agentId)} OR ${privateProject(channels.projectId)}))`;

/**
 * `resource_id` as the uuid key of widgets and dashboards. The CASE confines
 * the cast to rows of that type — other roots hold ids that are not uuids —
 * and keeps the source table's primary-key index usable.
 */
const uuidResourceId = (type: TrashResourceType) =>
  sql`(CASE WHEN ${trashItems.resourceType} = ${type} THEN ${trashItems.resourceId}::uuid END)`;

/** The root's source row is gone. */
const missingSourceWhere = (): SQL =>
  or(
    ...(
      Object.entries(ROOT_TABLES) as [TrashResourceType, (typeof ROOT_TABLES)[TrashResourceType]][]
    ).map(([type, source]) =>
      and(
        eq(trashItems.resourceType, type),
        type === 'widget' || type === 'dashboard'
          ? sql`NOT EXISTS (SELECT 1 FROM ${source.table} WHERE ${source.id} = ${uuidResourceId(type)})`
          : sql`NOT EXISTS (SELECT 1 FROM ${source.table} WHERE ${source.id} = ${trashItems.resourceId})`,
      ),
    ),
  ) as SQL;

/**
 * Whether a registry row's resource is private right now: the resource itself,
 * or an agent, group, project or channel it lives under, is visible to its
 * creator (or, for a channel, its members) only. Read from the source rows —
 * they stay in place while trashed.
 */
const livePrivateWhere = (): SQL =>
  or(
    privateProject(trashItems.projectId),
    and(eq(trashItems.resourceType, 'agent'), privateAgent(trashItems.resourceId)),
    and(eq(trashItems.resourceType, 'topic'), privateTopic(trashItems.resourceId)),
    and(eq(trashItems.resourceType, 'channel'), privateChannel(trashItems.resourceId)),
    and(
      eq(trashItems.resourceType, 'channelThread'),
      sql`EXISTS (SELECT 1 FROM ${channelThreads} WHERE ${channelThreads.id} = ${trashItems.resourceId} AND ${privateChannel(channelThreads.channelId)})`,
    ),
    and(
      eq(trashItems.resourceType, 'message'),
      sql`EXISTS (SELECT 1 FROM ${messages} WHERE ${messages.id} = ${trashItems.resourceId} AND (${privateAgent(messages.agentId)} OR ${privateGroup(messages.groupId)} OR ${privateTopic(messages.topicId)}))`,
    ),
    and(
      eq(trashItems.resourceType, 'widget'),
      sql`EXISTS (SELECT 1 FROM ${widgets} WHERE ${widgets.id} = ${uuidResourceId('widget')} AND (${widgets.visibility} = 'private' OR ${privateAgent(widgets.agentId)} OR ${privateProject(widgets.projectId)}))`,
    ),
    and(
      eq(trashItems.resourceType, 'dashboard'),
      sql`EXISTS (SELECT 1 FROM ${dashboards} WHERE ${dashboards.id} = ${uuidResourceId('dashboard')} AND (${dashboards.visibility} = 'private' OR ${privateAgent(dashboards.agentId)} OR ${privateProject(dashboards.projectId)}))`,
    ),
  ) as SQL;

/**
 * Whether a registry row sits on the private side of its workspace bin. A root
 * keeps the side it had when it was trashed (`meta.private`, snapshotted by
 * `registerMany`), so making a still-live parent public later does not expose
 * it.
 *
 * A root registered before the snapshot existed has no `meta.private`; it
 * falls back to the live check, like every other workspace list. Otherwise it
 * fails closed: a root whose source row or recorded project was removed
 * outside the trash (a hard delete or an FK cascade) cannot prove it was
 * shared, so it stays on its deleter's private side.
 */
const privateRootWhere = (): SQL =>
  or(
    missingSourceWhere(),
    and(
      sql`${trashItems.projectId} IS NOT NULL`,
      sql`NOT EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.id} = ${trashItems.projectId})`,
    ),
    // COALESCE: a NULL here would turn the whole OR, and its NOT, into NULL.
    sql`COALESCE((${trashItems.meta} ->> 'private') = 'true', false)`,
    and(sql`NOT COALESCE(jsonb_exists(${trashItems.meta}, 'private'), false)`, livePrivateWhere()),
  ) as SQL;

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

  /**
   * The roots one recycle-bin view covers. The list, its counts and "empty
   * trash" all build on this, so a filter can never show one set of rows and
   * count or purge another. Children are never matched on their own: a
   * cascade is listed, counted and purged through its root, whatever project
   * its children were recorded under.
   */
  private rootsWhere = ({
    deletedByUserId,
    projectId,
    resourceType,
    visibility,
  }: TrashRootFilter = {}) =>
    and(
      this.ownership(),
      isNull(trashItems.rootId),
      resourceType ? eq(trashItems.resourceType, resourceType) : undefined,
      deletedByUserId ? eq(trashItems.deletedByUserId, deletedByUserId) : undefined,
      // Personal bins have no sides: every row there is the caller's own.
      !this.workspaceId || !visibility
        ? undefined
        : visibility === 'private'
          ? privateRootWhere()
          : not(privateRootWhere()),
      projectId === undefined
        ? undefined
        : projectId === null
          ? isNull(trashItems.projectId)
          : eq(trashItems.projectId, projectId),
    );

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
        projectId: root.projectId,
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
            // Preserve the first project context, including historical NULL, on retries.
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

      // Snapshot each workspace root's side while its parents still describe
      // it; the upsert above replaced `meta`, so a retry re-snapshots too.
      if (this.workspaceId) {
        const rootIds = [...rootsByKey.values()].map((row) => row.id);
        for (let i = 0; i < rootIds.length; i += REGISTER_CHUNK_SIZE) {
          const rows = await tx
            .update(trashItems)
            .set({
              meta: sql`coalesce(${trashItems.meta}, '{}'::jsonb) || jsonb_build_object('private', ${livePrivateWhere()})`,
            })
            .where(inArray(trashItems.id, rootIds.slice(i, i + REGISTER_CHUNK_SIZE)))
            .returning();
          for (const row of rows) rootsByKey.set(key(row.resourceType, row.resourceId), row);
        }
      }

      const childValues: NewTrashItemRow[] = params.cascades.flatMap(({ children, root }) => {
        const rootRow = rootsByKey.get(key(root.resourceType, root.resourceId))!;
        return (children ?? []).map((child) => ({
          ...stamp,
          meta: child.meta ?? null,
          projectId: child.projectId,
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
          this.rootsWhere(params),
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

  /** Roots per type under the same filter as `list` (the type filter itself aside). */
  countByType = async (
    filter: Omit<TrashRootFilter, 'resourceType'> = {},
  ): Promise<TrashCountByType> => {
    const rows = await this.db
      .select({ resourceType: trashItems.resourceType, total: count() })
      .from(trashItems)
      .where(
        this.rootsWhere({
          deletedByUserId: filter.deletedByUserId,
          projectId: filter.projectId,
          visibility: filter.visibility,
        }),
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

  /** Ids among `ids` (in scope) that sit on the private side of the workspace bin. */
  findPrivateIds = async (ids: string[]): Promise<Set<string>> => {
    if (ids.length === 0 || !this.workspaceId) return new Set();
    const rows = await this.db
      .select({ id: trashItems.id })
      .from(trashItems)
      .where(and(inArray(trashItems.id, ids), this.ownership(), privateRootWhere()));
    return new Set(rows.map((row) => row.id));
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

  /** Roots matching a recycle-bin view, oldest first — used by "empty trash". */
  listAllRootIds = async (
    options: TrashRootFilter & {
      /** Cap the ids returned — empty-trash works one bounded batch per request. */
      limit?: number;
    } = {},
  ): Promise<string[]> => {
    const query = this.db
      .select({ id: trashItems.id })
      .from(trashItems)
      .where(this.rootsWhere(options))
      .orderBy(asc(trashItems.deletedAt), asc(trashItems.id));
    const rows = await (options.limit ? query.limit(options.limit) : query);
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
            // `::text` because some roots (widgets, dashboards) key on uuid while the registry stores text ids
            sql`NOT EXISTS (SELECT 1 FROM ${source.table} WHERE ${source.id}::text = ${trashItems.resourceId} AND ${source.isDeleted} = true)`,
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
    /* v8 ignore next -- unreachable: Buffer.from(string, 'base64url') and Number() never throw */
    return null;
  }
};
