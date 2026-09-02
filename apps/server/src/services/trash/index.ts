import { randomUUID } from 'node:crypto';

import { TRASH_LIST_PAGE_SIZE, TRASH_PURGE_BATCH_SIZE } from '@lobechat/const';
import type {
  TrashCountByType,
  TrashItem,
  TrashListParams,
  TrashListResult,
  TrashResourceType,
  TrashRestoreErrorCode,
} from '@lobechat/types';
import debug from 'debug';

import { notifyResourceTrashMutation } from '@/business/server/resource/notifyTrashMutation';
import { TrashModel } from '@/database/models/trash';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import type { TrashItemRow } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';
import { FileService } from '@/server/services/file';
import { getRestrictedKnowledgeBaseIds } from '@/server/services/knowledgeBaseAccess';

import {
  resolveTrashHandler,
  softDeleteDocuments,
  softDeleteFiles,
  softDeleteKnowledgeBases,
  type TrashCascade,
  type TrashHandlerContext,
  TrashRestoreError,
} from './handlers';

const log = debug('lobe-server:trash');

const WORKSPACE_RESOURCE_TYPES = new Set<TrashResourceType>(['document', 'file', 'knowledgeBase']);

type WorkspaceResourceTrashType = 'document' | 'file' | 'knowledgeBase';

const isWorkspaceResourceType = (type: TrashResourceType): type is WorkspaceResourceTrashType =>
  WORKSPACE_RESOURCE_TYPES.has(type);

export { TrashRestoreError } from './handlers';

export interface TrashOptions {
  /** Workspace non-owner members may only sweep their own rows. */
  restrictToCreator?: boolean;
}

export interface TrashRestoreOutcome {
  failed: { code: TrashRestoreErrorCode; id: string }[];
  restored: TrashItem[];
}

export interface TrashPurgeOutcome {
  failed: { code: 'notFound' | 'purgeFailed'; id: string }[];
  purged: number;
  purgedIds: string[];
}

export interface TrashSweepOutcome {
  /** Roots that threw during purge — left in place for the next tick. */
  failed: number;
  /** Registry rows dropped because their resource was already gone. */
  pruned: number;
  /** Roots hard-deleted this tick. */
  purged: number;
}

/**
 * Recycle-bin orchestrator. Every user-facing "delete" of a trash-aware entity
 * funnels through `trashXxx` here: the handler stamps the rows (and their
 * cascade), and the registry gets one root row plus a child row per cascaded
 * resource. Restore / purge walk the registry the other way.
 *
 * Stamp + register run in one transaction, so a failure between the two can
 * never leave rows hidden but unlisted.
 */
export class TrashService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;
  private readonly trashModel: TrashModel;
  private fileServiceInstance?: FileService;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.trashModel = new TrashModel(db, userId, workspaceId);
  }

  /**
   * Built on first use: the storage client reads S3 env at construction, and
   * the service is instantiated in router middleware for every request —
   * only purge paths ever need it.
   */
  private get fileService(): FileService {
    this.fileServiceInstance ??= new FileService(this.db, this.userId, this.workspaceId);
    return this.fileServiceInstance;
  }

  private ctx = (db: LobeChatDatabase = this.db): TrashHandlerContext => {
    const getFileService = () => this.fileService;
    return {
      db,
      get fileService() {
        return getFileService();
      },
      userId: this.userId,
      workspaceId: this.workspaceId,
    };
  };

  private stampOptions = (options?: TrashOptions): SoftDeleteOptions => ({
    deletedAt: new Date(),
    restrictToCreator: options?.restrictToCreator,
  });

  /** Run a soft delete and register whatever it produced, atomically. */
  private async commit(
    run: (ctx: TrashHandlerContext) => Promise<TrashCascade[] | TrashCascade | null>,
    deletedAt: Date,
  ): Promise<TrashItemRow[]> {
    const batchOperationId = randomUUID();
    const roots = await this.db.transaction(async (tx) => {
      const db = tx as unknown as LobeChatDatabase;
      const produced = await run(this.ctx(db));
      const cascades = (Array.isArray(produced) ? produced : produced ? [produced] : []).filter(
        Boolean,
      );
      const registry = new TrashModel(db, this.userId, this.workspaceId);
      const roots: TrashItemRow[] = [];
      for (const cascade of cascades) {
        const root = await registry.register(
          { children: cascade.children, deletedAt, root: cascade.root },
          tx,
        );
        await this.recordResourceAudit(db, tx, root, 'resource.deleted', {
          batchOperationId,
          occurredAt: deletedAt,
        });
        roots.push(root);
      }
      log(
        'trashed %d root(s): %o',
        roots.length,
        roots.map((r) => `${r.resourceType}:${r.resourceId}`),
      );
      return roots;
    });
    await this.notifyResourceMutationBestEffort(roots, 'deleted');
    return roots;
  }

  private recordResourceAudit = async (
    db: LobeChatDatabase,
    trx: Transaction,
    root: TrashItemRow,
    action: 'resource.deleted' | 'resource.restored',
    params: { batchOperationId: string; occurredAt: Date },
  ) => {
    if (!this.workspaceId || !isWorkspaceResourceType(root.resourceType)) return;

    await new WorkspaceAuditLogModel(db).create(
      {
        action,
        metadata: {
          actorUserId: this.userId,
          batchOperationId: params.batchOperationId,
          creatorUserId: root.meta?.creatorUserId ?? root.userId,
          knowledgeBaseId: root.meta?.knowledgeBaseId ?? null,
          occurredAt: params.occurredAt.toISOString(),
          parentId: root.meta?.parentId ?? null,
          resourceTitle: root.title,
          trashItemId: root.id,
        },
        resourceId: root.resourceId,
        resourceType: root.resourceType,
        userId: this.userId,
        workspaceId: this.workspaceId,
      },
      trx,
    );
  };

  private notifyResourceMutationBestEffort = async (
    roots: TrashItemRow[],
    event: 'deleted' | 'restored',
  ) => {
    const workspaceId = this.workspaceId;
    if (!workspaceId) return;

    await Promise.all(
      roots.map(async (root) => {
        if (!isWorkspaceResourceType(root.resourceType)) return;
        const recipientUserId = root.meta?.creatorUserId ?? root.userId;
        if (!recipientUserId || recipientUserId === this.userId) return;

        try {
          await notifyResourceTrashMutation({
            actorUserId: this.userId,
            event,
            recipientUserId,
            resourceId: root.resourceId,
            resourceTitle: root.title,
            resourceType: root.resourceType,
            trashItemId: root.id,
            workspaceId,
          });
        } catch (error) {
          log(
            'failed to notify resource trash mutation %s:%s: %O',
            root.resourceType,
            root.resourceId,
            error,
          );
        }
      }),
    );
  };

  // ─────────────────────────── trash (soft delete) ───────────────────────────

  trashFiles = async (ids: string[], options?: TrashOptions) => {
    const stamp = this.stampOptions(options);
    return this.commit((ctx) => softDeleteFiles(ctx, ids, stamp), stamp.deletedAt);
  };

  trashDocuments = async (ids: string[], options?: TrashOptions) => {
    const stamp = this.stampOptions(options);
    return this.commit((ctx) => softDeleteDocuments(ctx, ids, stamp), stamp.deletedAt);
  };

  trashKnowledgeBases = async (ids: string[], options?: TrashOptions) => {
    const stamp = this.stampOptions(options);
    return this.commit((ctx) => softDeleteKnowledgeBases(ctx, ids, stamp), stamp.deletedAt);
  };

  // ─────────────────────────── list ───────────────────────────

  list = async (params: TrashListParams = {}): Promise<TrashListResult> => {
    if (!this.workspaceId) return this.trashModel.list(params);

    const limit = Math.min(Math.max(params.limit ?? TRASH_LIST_PAGE_SIZE, 1), 200);
    const items: TrashItem[] = [];
    let cursor = params.cursor;
    let nextCursor: string | null;

    // Restricted libraries and their contents are caller-relative. Fetch in
    // page-sized chunks until the visible page is full so filtering never
    // leaks titles and does not leave avoidable holes in the recycle bin.
    do {
      const page = await this.trashModel.list({
        ...params,
        cursor,
        limit: limit - items.length,
      });
      items.push(...(await this.filterRestrictedResources(page.items)));
      nextCursor = page.nextCursor;
      cursor = page.nextCursor;
    } while (items.length < limit && cursor);

    return { items, nextCursor };
  };

  countByType = async (): Promise<TrashCountByType> => {
    if (!this.workspaceId) return this.trashModel.countByType();

    const counts: TrashCountByType = {};
    let cursor: string | null | undefined;
    do {
      const page = await this.list({ cursor, limit: 200 });
      for (const item of page.items) {
        counts[item.resourceType] = (counts[item.resourceType] ?? 0) + 1;
      }
      cursor = page.nextCursor;
    } while (cursor);
    return counts;
  };

  findByIds = async (ids: string[]): Promise<TrashItem[]> => {
    const items = (await this.trashModel.findByIds(ids)).map(this.toItem);
    return this.filterRestrictedResources(items);
  };

  private filterRestrictedResources = async (items: TrashItem[]): Promise<TrashItem[]> => {
    if (!this.workspaceId || items.length === 0) return items;

    const restrictedKnowledgeBaseIds = await getRestrictedKnowledgeBaseIds({
      serverDB: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    if (restrictedKnowledgeBaseIds.length === 0) return items;

    const hidden = await this.trashModel.findRestrictedResourceRootIds(
      items,
      restrictedKnowledgeBaseIds,
    );

    return items.filter((item) => !hidden.has(item.id));
  };

  // ─────────────────────────── restore ───────────────────────────

  /**
   * Restore roots by registry id. Each root is its own unit of work: one that
   * cannot come back (parent still in the bin, resource already gone) is
   * reported in `failed` and does not block the others.
   */
  restore = async (itemIds: string[]): Promise<TrashRestoreOutcome> => {
    const outcome: TrashRestoreOutcome = { failed: [], restored: [] };
    const batchOperationId = randomUUID();
    const restoredAt = new Date();
    const roots = await this.trashModel.findByIds(itemIds);
    const known = new Set(roots.map((row) => row.id));
    for (const id of itemIds) {
      if (!known.has(id)) outcome.failed.push({ code: 'notFound', id });
    }

    for (const root of roots) {
      if (root.rootId) {
        // Children are restored through their root, never on their own.
        outcome.failed.push({ code: 'parentTrashed', id: root.id });
        continue;
      }
      try {
        await this.db.transaction(async (tx) => {
          const db = tx as unknown as LobeChatDatabase;
          const registry = new TrashModel(db, this.userId, this.workspaceId);
          const children = await registry.findChildren(root.id, tx);
          await resolveTrashHandler(root.resourceType).restore(this.ctx(db), root, children);
          await this.recordResourceAudit(db, tx, root, 'resource.restored', {
            batchOperationId,
            occurredAt: restoredAt,
          });
          await registry.removeByIds([root.id], tx);
        });
        outcome.restored.push(this.toItem(root));
        await this.notifyResourceMutationBestEffort([root], 'restored');
      } catch (error) {
        if (error instanceof TrashRestoreError) {
          if (error.code === 'notFound') {
            // Nothing to bring back — drop the stale registry row so the bin
            // stops advertising it.
            await this.trashModel.removeByIds([root.id]);
          }
          outcome.failed.push({ code: error.code, id: root.id });
          continue;
        }
        throw error;
      }
    }
    return outcome;
  };

  // ─────────────────────────── purge (hard delete) ───────────────────────────

  /** Permanently delete roots by registry id (their cascade goes with them). */
  purge = async (itemIds: string[]): Promise<TrashPurgeOutcome> => {
    const roots = (await this.trashModel.findByIds(itemIds)).filter((row) => !row.rootId);
    const outcome: TrashPurgeOutcome = { failed: [], purged: 0, purgedIds: [] };
    const found = new Set(roots.map((root) => root.id));
    for (const id of itemIds) {
      if (!found.has(id)) outcome.failed.push({ code: 'notFound', id });
    }
    for (const root of roots) {
      try {
        await this.purgeRoot(root);
        outcome.purged += 1;
        outcome.purgedIds.push(root.id);
      } catch (error) {
        log('failed to purge %s:%s: %O', root.resourceType, root.resourceId, error);
        outcome.failed.push({ code: 'purgeFailed', id: root.id });
      }
    }
    return outcome;
  };

  /** Permanently delete every root in the caller's bin, optionally one type only. */
  emptyTrash = async (options?: {
    resourceType?: TrashResourceType;
  }): Promise<{ purged: number }> => {
    let purged = 0;
    // Page through: purging shrinks the set, so re-listing until empty is the
    // simplest way to stay correct under concurrent deletes.
    for (;;) {
      const ids = await this.trashModel.listAllRootIds(options);
      if (ids.length === 0) break;
      const result = await this.purge(ids.slice(0, TRASH_PURGE_BATCH_SIZE));
      purged += result.purged;
      if (result.purged === 0) break;
    }
    return { purged };
  };

  private purgeRoot = async (root: TrashItemRow) => {
    const children = await this.trashModel.findChildren(root.id);
    // Side effects (S3) and hard deletes are not transactional with each
    // other by nature; run them, then drop the registry rows. If the handler
    // throws, the root stays listed and the sweep retries next tick.
    await resolveTrashHandler(root.resourceType).purge(this.ctx(), root, children);
    await this.trashModel.removeByIds([root.id]);
    log('purged %s:%s (+%d children)', root.resourceType, root.resourceId, children.length);
  };

  private toItem = (row: TrashItemRow): TrashItem => ({
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

  // ─────────────────────────── sweep (cron) ───────────────────────────

  /**
   * Hard-delete every root past its `expiresAt`, across all users. Runs as a
   * QStash schedule (see `router-hono/workflows/trash`). Each root is purged
   * under its owner's scope; one failure is logged and skipped so a single
   * poisoned row cannot stall the sweep.
   */
  static sweepExpired = async (
    db: LobeChatDatabase,
    options?: { limit?: number; now?: Date },
  ): Promise<TrashSweepOutcome> => {
    const outcome: TrashSweepOutcome = { failed: 0, pruned: 0, purged: 0 };
    const roots = await TrashModel.listExpiredRoots(db, {
      limit: options?.limit ?? TRASH_PURGE_BATCH_SIZE,
      now: options?.now,
    });

    for (const root of roots) {
      const service = new TrashService(db, root.userId, root.workspaceId ?? undefined);
      try {
        await service.purgeRoot(root);
        outcome.purged += 1;
      } catch (error) {
        outcome.failed += 1;
        log('purge failed for %s:%s — %O', root.resourceType, root.resourceId, error);
      }
    }

    outcome.pruned = await TrashModel.pruneOrphans(db);
    return outcome;
  };
}
