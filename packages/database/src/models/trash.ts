import { TRASH_LIST_PAGE_SIZE, TRASH_RETENTION_MS } from '@lobechat/const';
import type {
  TrashCountByType,
  TrashItem,
  TrashListParams,
  TrashListResult,
  TrashResourceType,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  not,
  or,
  sql,
} from 'drizzle-orm';

import type { NewTrashItemRow, TrashItemRow, TrashItemRowMeta } from '../schemas';
import { documents, files, knowledgeBaseFiles, knowledgeBases, trashItems } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export interface TrashRegisterEntry {
  meta?: TrashItemRowMeta | null;
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

export interface TrashExpiredCursor {
  expiresAt: Date;
  id: string;
}

export interface TrashRestrictedResourceFilter {
  /** Exact document ids protected only by a trashed restricted knowledge base. */
  documentIds?: string[];
  /** Exact file ids protected only by a trashed restricted knowledge base. */
  fileIds?: string[];
  /** Restricted knowledge-base roots, whether live or trashed. */
  knowledgeBaseIds?: string[];
  /** Live restricted knowledge bases whose current contents remain hidden. */
  membershipKnowledgeBaseIds?: string[];
}

/**
 * Source tables for the "does the resource still exist" checks. Purge relies
 * on FK cascades for children, so a root's registry row can be orphaned only
 * when its resource was hard-deleted through a non-trash path — the sweep
 * uses this map to prune those.
 */
const ROOT_TABLES: Record<TrashResourceType, { id: any; isDeleted: any; table: any }> = {
  document: { id: documents.id, isDeleted: documents.isDeleted, table: documents },
  file: { id: files.id, isDeleted: files.isDeleted, table: files },
  knowledgeBase: {
    id: knowledgeBases.id,
    isDeleted: knowledgeBases.isDeleted,
    table: knowledgeBases,
  },
};

export const toPublicTrashItem = (row: TrashItemRow): TrashItem => {
  const {
    detachedEdges: _detachedEdges,
    storageCleanup: _storageCleanup,
    ...publicMeta
  } = row.meta ?? {};
  return {
    deletedAt: row.deletedAt,
    deletedByUserId: row.deletedByUserId,
    expiresAt: row.expiresAt,
    id: row.id,
    meta: Object.keys(publicMeta).length > 0 ? publicMeta : null,
    resourceId: row.resourceId,
    resourceType: row.resourceType,
    rootId: row.rootId,
    title: row.title,
    userId: row.userId,
    workspaceId: row.workspaceId,
  };
};

/**
 * Registry over trashed rows — see `schemas/trash.ts` for the contract.
 *
 * Scope: personal mode lists the caller's own roots; workspace mode lists
 * every visible Resource root in the workspace. The row records who pressed
 * delete separately from the original creator.
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

  /** Private workspace resources stay visible only to their original creator. */
  private visibleResource = () =>
    this.workspaceId
      ? or(
          sql`COALESCE(${trashItems.meta}->>'visibility', '') <> 'private'`,
          sql`${trashItems.meta}->>'creatorUserId' = ${this.userId}`,
        )
      : undefined;

  /** Roots not explicitly queued by "empty trash" (`expiresAt = deletedAt`). */
  private active = () => gt(trashItems.expiresAt, trashItems.deletedAt);

  private excludeRestrictedResources = (filter: TrashRestrictedResourceFilter): SQL | undefined => {
    const documentIds = filter.documentIds ?? [];
    const fileIds = filter.fileIds ?? [];
    const knowledgeBaseIds = filter.knowledgeBaseIds ?? [];
    const membershipKnowledgeBaseIds = filter.membershipKnowledgeBaseIds ?? [];
    if (
      documentIds.length === 0 &&
      fileIds.length === 0 &&
      knowledgeBaseIds.length === 0 &&
      membershipKnowledgeBaseIds.length === 0
    ) {
      return;
    }

    const fileInRestrictedKnowledgeBase =
      membershipKnowledgeBaseIds.length > 0
        ? exists(
            this.db
              .select({ fileId: knowledgeBaseFiles.fileId })
              .from(knowledgeBaseFiles)
              .where(
                and(
                  eq(knowledgeBaseFiles.fileId, trashItems.resourceId),
                  inArray(knowledgeBaseFiles.knowledgeBaseId, membershipKnowledgeBaseIds),
                ),
              ),
          )
        : undefined;
    const documentInRestrictedKnowledgeBase =
      membershipKnowledgeBaseIds.length > 0
        ? exists(
            this.db
              .select({ id: documents.id })
              .from(documents)
              .leftJoin(knowledgeBaseFiles, eq(documents.fileId, knowledgeBaseFiles.fileId))
              .where(
                and(
                  eq(documents.id, trashItems.resourceId),
                  or(
                    inArray(documents.knowledgeBaseId, membershipKnowledgeBaseIds),
                    inArray(knowledgeBaseFiles.knowledgeBaseId, membershipKnowledgeBaseIds),
                  ),
                ),
              ),
          )
        : undefined;
    const restricted = or(
      knowledgeBaseIds.length > 0
        ? and(
            eq(trashItems.resourceType, 'knowledgeBase'),
            inArray(trashItems.resourceId, knowledgeBaseIds),
          )
        : undefined,
      documentIds.length > 0
        ? and(eq(trashItems.resourceType, 'document'), inArray(trashItems.resourceId, documentIds))
        : undefined,
      fileIds.length > 0
        ? and(eq(trashItems.resourceType, 'file'), inArray(trashItems.resourceId, fileIds))
        : undefined,
      fileInRestrictedKnowledgeBase
        ? and(eq(trashItems.resourceType, 'file'), fileInRestrictedKnowledgeBase)
        : undefined,
      documentInRestrictedKnowledgeBase
        ? and(eq(trashItems.resourceType, 'document'), documentInRestrictedKnowledgeBase)
        : undefined,
    );

    return restricted ? not(restricted) : undefined;
  };

  // ─────────────────────────── writes ───────────────────────────

  /**
   * Register a root (and its cascaded children) in the bin. Idempotent on the
   * resource: trashing something already registered updates its stamp instead
   * of failing the unique index, so a retried request converges.
   */
  register = async (params: TrashRegisterParams, trx?: Transaction): Promise<TrashItemRow> => {
    const run = async (tx: Transaction | LobeChatDatabase) => {
      const expiresAt =
        params.expiresAt ?? new Date(params.deletedAt.getTime() + TRASH_RETENTION_MS);
      const scope = { userId: this.userId, workspaceId: this.workspaceId ?? null };

      const [root] = await tx
        .insert(trashItems)
        .values({
          ...scope,
          userId: params.root.meta?.creatorUserId ?? scope.userId,
          deletedAt: params.deletedAt,
          deletedByUserId: this.userId,
          expiresAt,
          meta: params.root.meta ?? null,
          resourceId: params.root.resourceId,
          resourceType: params.root.resourceType,
          rootId: null,
          title: params.root.title ?? null,
        })
        .onConflictDoUpdate({
          set: {
            deletedAt: params.deletedAt,
            deletedByUserId: this.userId,
            expiresAt,
            meta: params.root.meta ?? null,
            rootId: null,
            title: params.root.title ?? null,
          },
          target: [trashItems.resourceType, trashItems.resourceId],
        })
        .returning();

      const children = params.children ?? [];
      if (children.length > 0) {
        const values: NewTrashItemRow[] = children.map((child) => ({
          ...scope,
          userId: child.meta?.creatorUserId ?? scope.userId,
          deletedAt: params.deletedAt,
          deletedByUserId: this.userId,
          expiresAt,
          meta: child.meta ?? null,
          resourceId: child.resourceId,
          resourceType: child.resourceType,
          rootId: root.id,
          title: child.title ?? null,
        }));

        // A child that already has its own registry row (trashed earlier on
        // its own) keeps it: it was in the bin before the root and must stay
        // there after the root is restored. `DO NOTHING` preserves that.
        for (let i = 0; i < values.length; i += 500) {
          await tx
            .insert(trashItems)
            .values(values.slice(i, i + 500))
            .onConflictDoNothing({ target: [trashItems.resourceType, trashItems.resourceId] });
        }
      }

      return root;
    };

    return trx ? run(trx) : run(this.db);
  };

  /** Drop registry rows once their resource is restored or purged. Children cascade via `root_id`. */
  removeByIds = async (ids: string[], trx?: Transaction) => {
    if (ids.length === 0) return;
    const db = trx ?? this.db;
    await db.delete(trashItems).where(inArray(trashItems.id, ids));
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

  /**
   * Atomically move every visible root in scope into the background purge queue.
   * The retention sweep owns the expensive storage/database deletion work.
   */
  expireAllRoots = async (options?: {
    excludeResources?: TrashRestrictedResourceFilter;
    resourceType?: TrashResourceType;
  }): Promise<string[]> => {
    const rows = await this.db
      .update(trashItems)
      .set({ expiresAt: sql`${trashItems.deletedAt}` })
      .where(
        and(
          this.ownership(),
          isNull(trashItems.rootId),
          this.active(),
          options?.resourceType ? eq(trashItems.resourceType, options.resourceType) : undefined,
          this.visibleResource(),
          this.excludeRestrictedResources(options?.excludeResources ?? {}),
        ),
      )
      .returning({ id: trashItems.id });

    return rows.map((row) => row.id);
  };

  /**
   * Put roots back on their normal retention deadline when immediate purge
   * scheduling fails. Only rows still carrying the queue marker are touched,
   * so an already-purged or independently restored row is left alone.
   */
  restoreQueuedRoots = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;

    await this.db
      .update(trashItems)
      .set({
        expiresAt: sql`${trashItems.deletedAt} + (${TRASH_RETENTION_MS}::bigint * interval '1 millisecond')`,
      })
      .where(
        and(
          inArray(trashItems.id, ids),
          this.ownership(),
          eq(trashItems.expiresAt, trashItems.deletedAt),
        ),
      );
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
          this.active(),
          params.resourceType ? eq(trashItems.resourceType, params.resourceType) : undefined,
          this.visibleResource(),
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
      items: page.map((row) => toPublicTrashItem(row)),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  };

  countByType = async (
    excludeResources: TrashRestrictedResourceFilter = {},
  ): Promise<TrashCountByType> => {
    const rows = await this.db
      .select({ resourceType: trashItems.resourceType, total: count() })
      .from(trashItems)
      .where(
        and(
          this.ownership(),
          isNull(trashItems.rootId),
          this.active(),
          this.visibleResource(),
          this.excludeRestrictedResources(excludeResources),
        ),
      )
      .groupBy(trashItems.resourceType);

    return Object.fromEntries(rows.map((row) => [row.resourceType, row.total]));
  };

  findById = async (id: string): Promise<TrashItemRow | undefined> => {
    return this.db.query.trashItems.findFirst({
      where: and(eq(trashItems.id, id), this.ownership(), this.active()),
    });
  };

  /** Internal purge lookup that also sees roots queued by empty-trash. */
  findByIdIncludingQueued = async (id: string): Promise<TrashItemRow | undefined> => {
    return this.db.query.trashItems.findFirst({
      where: and(eq(trashItems.id, id), this.ownership()),
    });
  };

  findByIds = async (ids: string[]): Promise<TrashItemRow[]> => {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(trashItems)
      .where(and(inArray(trashItems.id, ids), this.ownership(), this.active()));
  };

  /** Registry ids backed by a restricted knowledge base or one of its contents. */
  findRestrictedResourceRootIds = async (
    items: Pick<TrashItem, 'id' | 'resourceId' | 'resourceType'>[],
    filter: TrashRestrictedResourceFilter,
  ): Promise<Set<string>> => {
    if (items.length === 0) return new Set();

    const documentIds = new Set(filter.documentIds ?? []);
    const fileIds = new Set(filter.fileIds ?? []);
    const knowledgeBaseIds = new Set(filter.knowledgeBaseIds ?? []);
    const membershipKnowledgeBaseIds = filter.membershipKnowledgeBaseIds ?? [];

    const hidden = new Set(
      items
        .filter(
          (item) =>
            (item.resourceType === 'knowledgeBase' && knowledgeBaseIds.has(item.resourceId)) ||
            (item.resourceType === 'file' && fileIds.has(item.resourceId)) ||
            (item.resourceType === 'document' && documentIds.has(item.resourceId)),
        )
        .map((item) => item.id),
    );
    const filesByResourceId = new Map(
      items
        .filter((item) => item.resourceType === 'file')
        .map((item) => [item.resourceId, item.id]),
    );
    const documentsByResourceId = new Map(
      items
        .filter((item) => item.resourceType === 'document')
        .map((item) => [item.resourceId, item.id]),
    );

    if (filesByResourceId.size > 0 && membershipKnowledgeBaseIds.length > 0) {
      const rows = await this.db
        .select({ fileId: knowledgeBaseFiles.fileId })
        .from(knowledgeBaseFiles)
        .where(
          and(
            inArray(knowledgeBaseFiles.fileId, [...filesByResourceId.keys()]),
            inArray(knowledgeBaseFiles.knowledgeBaseId, membershipKnowledgeBaseIds),
          ),
        );
      for (const row of rows) {
        const itemId = filesByResourceId.get(row.fileId);
        if (itemId) hidden.add(itemId);
      }
    }

    if (documentsByResourceId.size > 0 && membershipKnowledgeBaseIds.length > 0) {
      const rows = await this.db
        .select({ id: documents.id })
        .from(documents)
        .leftJoin(knowledgeBaseFiles, eq(documents.fileId, knowledgeBaseFiles.fileId))
        .where(
          and(
            inArray(documents.id, [...documentsByResourceId.keys()]),
            or(
              inArray(documents.knowledgeBaseId, membershipKnowledgeBaseIds),
              inArray(knowledgeBaseFiles.knowledgeBaseId, membershipKnowledgeBaseIds),
            ),
          ),
        );
      for (const row of rows) {
        const itemId = documentsByResourceId.get(row.id);
        if (itemId) hidden.add(itemId);
      }
    }

    return hidden;
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
        this.active(),
      ),
    });
  };

  /** Registry rows cascaded under a root (any type). */
  findChildren = async (rootId: string, trx?: Transaction): Promise<TrashItemRow[]> => {
    const db = trx ?? this.db;
    return db.select().from(trashItems).where(eq(trashItems.rootId, rootId));
  };

  // ─────────────────────────── sweep (global, not user-scoped) ───────────────────────────

  /**
   * Expired roots across every user, oldest first. The purge sweep instantiates
   * a per-owner service for each so hard deletes run under the right scope.
   */
  static listExpiredRoots = async (
    db: LobeChatDatabase,
    params: { cursor?: TrashExpiredCursor; limit: number; now?: Date },
  ): Promise<TrashItemRow[]> => {
    const now = params.now ?? new Date();
    return db
      .select()
      .from(trashItems)
      .where(
        and(
          isNull(trashItems.rootId),
          lte(trashItems.expiresAt, now),
          params.cursor
            ? or(
                gt(trashItems.expiresAt, params.cursor.expiresAt),
                and(
                  eq(trashItems.expiresAt, params.cursor.expiresAt),
                  gt(trashItems.id, params.cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(trashItems.expiresAt), asc(trashItems.id))
      .limit(params.limit);
  };

  static markStorageCleanupPending = async (
    trx: Transaction,
    rootId: string,
    storageFiles: { fileHash: string; url: string }[],
  ): Promise<void> => {
    if (storageFiles.length === 0) return;

    const storageCleanup: NonNullable<TrashItemRowMeta['storageCleanup']> = {
      files: storageFiles,
      pending: true,
    };
    const updated = await trx
      .update(trashItems)
      .set({
        meta: sql<TrashItemRowMeta>`jsonb_set(COALESCE(${trashItems.meta}, '{}'::jsonb), '{storageCleanup}', ${JSON.stringify(storageCleanup)}::jsonb, true)`,
      })
      .where(and(eq(trashItems.id, rootId), isNull(trashItems.rootId)))
      .returning({ id: trashItems.id });
    if (updated.length === 0) throw new Error(`Trash root not found: ${rootId}`);
  };

  /**
   * Drop root registry rows whose resource no longer exists (hard-deleted
   * through a non-trash path — a user purge, an FK cascade from a parent that
   * was itself purged, …) or is no longer stamped (restored through a
   * non-trash path). Roots carrying pending storage cleanup remain as the
   * durable retry record. Returns how many were pruned.
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
            sql`COALESCE(${trashItems.meta}->'storageCleanup'->>'pending', 'false') <> 'true'`,
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
