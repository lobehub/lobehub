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
import { documents, files, knowledgeBases, trashItems } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import {
  documentInRestrictedKnowledgeBase,
  fileInRestrictedKnowledgeBase,
} from '../utils/restrictedKnowledgeBase';
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
  /** Restricted knowledge-base roots, whether live or trashed. */
  knowledgeBaseIds?: string[];
  /** Live restricted knowledge bases whose current contents remain hidden. */
  membershipKnowledgeBaseIds?: string[];
  /** Trashed restricted KBs; only otherwise-unshared contents remain hidden. */
  trashedMembershipKnowledgeBaseIds?: string[];
}

const PURGE_RETRY_DELAY_MS = 60 * 60 * 1000;

/**
 * Source tables for the "does the resource still exist" checks. Purge relies
 * on FK cascades for children, so a root's registry row can be orphaned only
 * when its resource was hard-deleted through a non-trash path — the sweep
 * uses this map to prune those.
 */
const ROOT_TABLES: Partial<Record<TrashResourceType, { id: any; isDeleted: any; table: any }>> = {
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
    purgeBlocked: _purgeBlocked,
    purgeClaim: _purgeClaim,
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
  private active = () =>
    and(
      gt(trashItems.expiresAt, trashItems.deletedAt),
      sql`COALESCE(${trashItems.meta}->'purgeBlocked', 'false'::jsonb) <> 'true'::jsonb`,
    );

  private excludeRestrictedResources = (filter: TrashRestrictedResourceFilter): SQL | undefined => {
    const knowledgeBaseIds = filter.knowledgeBaseIds ?? [];
    const membershipKnowledgeBaseIds = filter.membershipKnowledgeBaseIds ?? [];
    const trashedMembershipKnowledgeBaseIds = filter.trashedMembershipKnowledgeBaseIds ?? [];
    if (
      knowledgeBaseIds.length === 0 &&
      membershipKnowledgeBaseIds.length === 0 &&
      trashedMembershipKnowledgeBaseIds.length === 0
    ) {
      return;
    }

    if (!this.workspaceId) return;
    const restrictedFilter = {
      liveKnowledgeBaseIds: membershipKnowledgeBaseIds,
      trashedKnowledgeBaseIds: trashedMembershipKnowledgeBaseIds,
    };
    const restrictedFile = fileInRestrictedKnowledgeBase(
      this.db,
      trashItems.resourceId,
      { userId: this.userId, workspaceId: this.workspaceId },
      restrictedFilter,
    );
    const restrictedDocument = documentInRestrictedKnowledgeBase(
      this.db,
      { fileId: documents.fileId, knowledgeBaseId: documents.knowledgeBaseId },
      { userId: this.userId, workspaceId: this.workspaceId },
      restrictedFilter,
    );
    const restrictedDocumentRoot = restrictedDocument
      ? exists(
          this.db
            .select({ id: documents.id })
            .from(documents)
            .where(and(eq(documents.id, trashItems.resourceId), restrictedDocument)),
        )
      : undefined;
    const restricted = or(
      knowledgeBaseIds.length > 0
        ? and(
            eq(trashItems.resourceType, 'knowledgeBase'),
            inArray(trashItems.resourceId, knowledgeBaseIds),
          )
        : undefined,
      restrictedFile ? and(eq(trashItems.resourceType, 'file'), restrictedFile) : undefined,
      restrictedDocumentRoot
        ? and(eq(trashItems.resourceType, 'document'), restrictedDocumentRoot)
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
    const [root] = await this.registerMany([params], trx);
    return root;
  };

  /** Register independent roots and all of their children in bounded bulk inserts. */
  registerMany = async (
    paramsList: TrashRegisterParams[],
    trx?: Transaction,
  ): Promise<TrashItemRow[]> => {
    if (paramsList.length === 0) return [];

    const run = async (tx: Transaction | LobeChatDatabase) => {
      const scope = { userId: this.userId, workspaceId: this.workspaceId ?? null };
      const rootValues: NewTrashItemRow[] = paramsList.map((params) => ({
        ...scope,
        userId: params.root.meta?.creatorUserId ?? scope.userId,
        deletedAt: params.deletedAt,
        deletedByUserId: this.userId,
        expiresAt: params.expiresAt ?? new Date(params.deletedAt.getTime() + TRASH_RETENTION_MS),
        meta: params.root.meta ?? null,
        resourceId: params.root.resourceId,
        resourceType: params.root.resourceType,
        rootId: null,
        title: params.root.title ?? null,
      }));
      const insertedRoots: TrashItemRow[] = [];

      for (let index = 0; index < rootValues.length; index += 500) {
        const roots = await tx
          .insert(trashItems)
          .values(rootValues.slice(index, index + 500))
          .onConflictDoUpdate({
            set: {
              deletedAt: sql`excluded.deleted_at`,
              deletedByUserId: sql`excluded.deleted_by_user_id`,
              expiresAt: sql`excluded.expires_at`,
              meta: sql`excluded.meta`,
              rootId: null,
              title: sql`excluded.title`,
            },
            target: [trashItems.resourceType, trashItems.resourceId],
          })
          .returning();
        insertedRoots.push(...roots);
      }

      const rootsByResource = new Map(
        insertedRoots.map((root) => [`${root.resourceType}:${root.resourceId}`, root]),
      );
      const values: NewTrashItemRow[] = [];
      for (const params of paramsList) {
        const root = rootsByResource.get(`${params.root.resourceType}:${params.root.resourceId}`);
        if (!root) throw new Error('Failed to register trash root');
        const expiresAt =
          params.expiresAt ?? new Date(params.deletedAt.getTime() + TRASH_RETENTION_MS);

        for (const child of params.children ?? []) {
          values.push({
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
          });
        }
      }

      if (values.length > 0) {
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

      return paramsList.map((params) =>
        rootsByResource.get(`${params.root.resourceType}:${params.root.resourceId}`)!,
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
    resourceTypes?: readonly TrashResourceType[];
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
          !options?.resourceType && options?.resourceTypes
            ? inArray(trashItems.resourceType, options.resourceTypes)
            : undefined,
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

  /**
   * Claim a root for permanent deletion and make it non-restorable in the same
   * transaction. A stale lease can be stolen by a later sweep after its owner
   * has had ample time to finish external storage cleanup.
   */
  claimRootForPurge = async (
    id: string,
    claim: { claimedAt: Date; id: string; staleBefore: Date },
  ): Promise<TrashItemRow | undefined> => {
    return this.db.transaction(async (trx) => {
      const [root] = await trx
        .select()
        .from(trashItems)
        .where(and(eq(trashItems.id, id), this.ownership(), isNull(trashItems.rootId)))
        .for('update');
      if (!root) return;

      const currentClaimedAt = root.meta?.purgeClaim?.claimedAt
        ? new Date(root.meta.purgeClaim.claimedAt)
        : undefined;
      if (
        currentClaimedAt &&
        !Number.isNaN(currentClaimedAt.getTime()) &&
        currentClaimedAt > claim.staleBefore
      ) {
        return;
      }

      const meta: TrashItemRowMeta = {
        ...root.meta,
        purgeClaim: { claimedAt: claim.claimedAt.toISOString(), id: claim.id },
      };
      const [claimed] = await trx
        .update(trashItems)
        .set({
          expiresAt: sql`LEAST(${trashItems.expiresAt}, ${trashItems.deletedAt})`,
          meta,
        })
        .where(eq(trashItems.id, root.id))
        .returning();
      return claimed;
    });
  };

  /** Release a failed purge for the next sweep while keeping restore blocked. */
  releasePurgeClaim = async (id: string, claimId: string): Promise<void> => {
    await this.db
      .update(trashItems)
      .set({
        expiresAt: new Date(Date.now() + PURGE_RETRY_DELAY_MS),
        meta: sql<TrashItemRowMeta>`jsonb_set(COALESCE(${trashItems.meta}, '{}'::jsonb) - 'purgeClaim', '{purgeBlocked}', 'true'::jsonb, true)`,
      })
      .where(
        and(
          eq(trashItems.id, id),
          this.ownership(),
          sql`${trashItems.meta}->'purgeClaim'->>'id' = ${claimId}`,
        ),
      );
  };

  removeClaimedRoot = async (id: string, claimId: string): Promise<boolean> => {
    const rows = await this.db
      .delete(trashItems)
      .where(
        and(
          eq(trashItems.id, id),
          this.ownership(),
          sql`${trashItems.meta}->'purgeClaim'->>'id' = ${claimId}`,
        ),
      )
      .returning({ id: trashItems.id });
    return rows.length > 0;
  };

  // ─────────────────────────── reads ───────────────────────────

  /**
   * Roots in the caller's scope, newest first, keyset-paginated on
   * `(deleted_at, id)`.
   */
  list = async (
    params: TrashListParams = {},
    excludeResources: TrashRestrictedResourceFilter = {},
    resourceTypes?: readonly TrashResourceType[],
  ): Promise<TrashListResult> => {
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
          !params.resourceType && resourceTypes
            ? inArray(trashItems.resourceType, resourceTypes)
            : undefined,
          this.visibleResource(),
          this.excludeRestrictedResources(excludeResources),
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
    resourceTypes?: readonly TrashResourceType[],
  ): Promise<TrashCountByType> => {
    const rows = await this.db
      .select({ resourceType: trashItems.resourceType, total: count() })
      .from(trashItems)
      .where(
        and(
          this.ownership(),
          isNull(trashItems.rootId),
          this.active(),
          resourceTypes ? inArray(trashItems.resourceType, resourceTypes) : undefined,
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

  /** Restore arbitration: lock and re-read an active root inside the caller's transaction. */
  findActiveRootForUpdate = async (
    id: string,
    trx: Transaction,
  ): Promise<TrashItemRow | undefined> => {
    const [root] = await trx
      .select()
      .from(trashItems)
      .where(
        and(
          eq(trashItems.id, id),
          this.ownership(),
          isNull(trashItems.rootId),
          this.active(),
          sql`COALESCE(${trashItems.meta}->'purgeBlocked', 'false'::jsonb) <> 'true'::jsonb`,
          sql`NOT COALESCE(jsonb_exists(${trashItems.meta}, 'purgeClaim'), false)`,
        ),
      )
      .for('update');
    return root;
  };

  /** Remove only a still-restorable stale root; never steal a purge worker's retry hand-off. */
  removeActiveByIds = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    await this.db
      .delete(trashItems)
      .where(
        and(
          inArray(trashItems.id, ids),
          this.ownership(),
          this.active(),
          sql`COALESCE(${trashItems.meta}->'purgeBlocked', 'false'::jsonb) <> 'true'::jsonb`,
          sql`NOT COALESCE(jsonb_exists(${trashItems.meta}, 'purgeClaim'), false)`,
        ),
      );
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

  /** Internal purge lookup that also sees queued or retry-blocked roots. */
  findByIdsIncludingQueued = async (ids: string[]): Promise<TrashItemRow[]> => {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(trashItems)
      .where(and(inArray(trashItems.id, ids), this.ownership()));
  };

  /** Registry ids backed by a restricted knowledge base or one of its contents. */
  findRestrictedResourceRootIds = async (
    items: Pick<TrashItem, 'id' | 'resourceId' | 'resourceType'>[],
    filter: TrashRestrictedResourceFilter,
  ): Promise<Set<string>> => {
    if (items.length === 0) return new Set();

    const knowledgeBaseIds = new Set(filter.knowledgeBaseIds ?? []);
    const hidden = new Set(
      items
        .filter(
          (item) => item.resourceType === 'knowledgeBase' && knowledgeBaseIds.has(item.resourceId),
        )
        .map((item) => item.id),
    );
    const candidateIds = items
      .filter((item) => item.resourceType === 'file' || item.resourceType === 'document')
      .map((item) => item.id);
    if (candidateIds.length === 0) return hidden;

    const restricted = this.excludeRestrictedResources(filter);
    if (!restricted) return hidden;
    const rows = await this.db
      .select({ id: trashItems.id })
      .from(trashItems)
      .where(and(inArray(trashItems.id, candidateIds), not(restricted)));
    for (const row of rows) hidden.add(row.id);
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
    return this.findChildrenByRootIds([rootId], trx);
  };

  /** Registry rows cascaded under any of the supplied roots (any type). */
  findChildrenByRootIds = async (rootIds: string[], trx?: Transaction): Promise<TrashItemRow[]> => {
    if (rootIds.length === 0) return [];
    const db = trx ?? this.db;
    return db.select().from(trashItems).where(inArray(trashItems.rootId, rootIds));
  };

  // ─────────────────────────── sweep (global, not user-scoped) ───────────────────────────

  /**
   * Expired roots across every user, oldest first. The purge sweep instantiates
   * a per-owner service for each so hard deletes run under the right scope.
   */
  static listExpiredRoots = async (
    db: LobeChatDatabase,
    params: {
      cursor?: TrashExpiredCursor;
      limit: number;
      now?: Date;
      resourceTypes?: readonly TrashResourceType[];
    },
  ): Promise<TrashItemRow[]> => {
    const now = params.now ?? new Date();
    return db
      .select()
      .from(trashItems)
      .where(
        and(
          isNull(trashItems.rootId),
          lte(trashItems.expiresAt, now),
          params.resourceTypes ? inArray(trashItems.resourceType, params.resourceTypes) : undefined,
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
      if (!source) continue;
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
