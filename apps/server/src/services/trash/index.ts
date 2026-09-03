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
import {
  toPublicTrashItem,
  TrashModel,
  type TrashRestrictedResourceFilter,
} from '@/database/models/trash';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import type { TrashItemRow } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';
import { FileService } from '@/server/services/file';
import { getRestrictedKnowledgeBasePolicy } from '@/server/services/knowledgeBaseAccess';
import { triggerTrashPurge } from '@/server/workflows/trash';

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
const PURGE_CLAIM_TTL_MS = 60 * 60 * 1000;

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

export interface TrashEmptyOutcome {
  /** Roots handed to the retention worker for permanent deletion. */
  scheduled: number;
}

export interface TrashSweepOutcome {
  /** Roots that threw during purge — left in place for the next tick. */
  failed: number;
  /** Last attempted root, used to advance past failures in the next batch. */
  nextCursor: TrashSweepCursor | null;
  /** Registry rows dropped because their resource was already gone. */
  pruned: number;
  /** Roots hard-deleted this tick. */
  purged: number;
  /** Roots attempted by this bounded sweep invocation. */
  scanned: number;
}

export interface TrashSweepCursor {
  expiresAt: string;
  id: string;
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
      const roots = await registry.registerMany(
        cascades.map((cascade) => ({
          children: cascade.children,
          deletedAt,
          root: cascade.root,
        })),
        tx,
      );
      const workspaceId = this.workspaceId;
      if (workspaceId) {
        await new WorkspaceAuditLogModel(db).createMany(
          roots
            .filter((root) => isWorkspaceResourceType(root.resourceType))
            .map((root) => ({
              action: 'resource.deleted',
              metadata: {
                actorUserId: this.userId,
                batchOperationId,
                creatorUserId: root.meta?.creatorUserId ?? root.userId,
                knowledgeBaseId: root.meta?.knowledgeBaseId ?? null,
                occurredAt: deletedAt.toISOString(),
                parentId: root.meta?.parentId ?? null,
                resourceTitle: root.title,
                trashItemId: root.id,
              },
              resourceId: root.resourceId,
              resourceType: root.resourceType,
              userId: this.userId,
              workspaceId,
            })),
          tx,
        );
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
    const excludeResources = await this.getRestrictedResourceFilter();
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
      items.push(...(await this.filterRestrictedResources(page.items, excludeResources)));
      nextCursor = page.nextCursor;
      cursor = page.nextCursor;
    } while (items.length < limit && cursor);

    return { items, nextCursor };
  };

  countByType = async (): Promise<TrashCountByType> => {
    if (!this.workspaceId) return this.trashModel.countByType();

    return this.trashModel.countByType(await this.getRestrictedResourceFilter());
  };

  findByIds = async (ids: string[]): Promise<TrashItem[]> => {
    const rows = await this.filterRestrictedRows(await this.trashModel.findByIds(ids));
    return rows.map(this.toItem);
  };

  private filterRestrictedRows = async (rows: TrashItemRow[]): Promise<TrashItemRow[]> => {
    if (!this.workspaceId || rows.length === 0) return rows;

    const visibleIds = new Set(
      (await this.filterRestrictedResources(rows.map(this.toItem))).map((item) => item.id),
    );
    return rows.filter((row) => visibleIds.has(row.id));
  };

  private getRestrictedResourceFilter = async (): Promise<TrashRestrictedResourceFilter> => {
    if (!this.workspaceId) return {};

    const policy = await getRestrictedKnowledgeBasePolicy({
      serverDB: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    return {
      knowledgeBaseIds: policy.allRestrictedKnowledgeBaseIds,
      membershipKnowledgeBaseIds: policy.liveRestrictedKnowledgeBaseIds,
      trashedMembershipKnowledgeBaseIds: policy.trashedRestrictedKnowledgeBaseIds,
    };
  };

  private filterRestrictedResources = async (
    items: TrashItem[],
    excludeResources?: TrashRestrictedResourceFilter,
  ): Promise<TrashItem[]> => {
    if (!this.workspaceId || items.length === 0) return items;

    const hidden = await this.trashModel.findRestrictedResourceRootIds(
      items,
      excludeResources ?? (await this.getRestrictedResourceFilter()),
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
    const roots = await this.filterRestrictedRows(await this.trashModel.findByIds(itemIds));
    const known = new Set(roots.map((row) => row.id));
    for (const id of itemIds) {
      if (!known.has(id)) outcome.failed.push({ code: 'notFound', id });
    }

    const selectedRoots = roots.filter((root) => !root.rootId);
    const rootsById = new Map(selectedRoots.map((root) => [root.id, root]));
    const closureChildren = await this.trashModel.findChildrenByRootIds(
      selectedRoots.map((root) => root.id),
    );
    const restoringDocumentOwners = new Map(
      selectedRoots
        .filter((root) => root.resourceType === 'document')
        .map((root) => [root.resourceId, root]),
    );
    for (const child of closureChildren) {
      if (child.resourceType !== 'document' || !child.rootId) continue;
      const owner = rootsById.get(child.rootId);
      if (owner) restoringDocumentOwners.set(child.resourceId, owner);
    }
    const dependenciesByRootId = new Map(selectedRoots.map((root) => [root.id, new Set<string>()]));
    for (const resource of [...selectedRoots, ...closureChildren]) {
      const owner = resource.rootId ? rootsById.get(resource.rootId) : rootsById.get(resource.id);
      const parentId = resource.meta?.parentId;
      const parentOwner = parentId ? restoringDocumentOwners.get(parentId) : undefined;
      if (!owner || !parentOwner || owner.id === parentOwner.id) continue;
      dependenciesByRootId.get(owner.id)?.add(parentOwner.id);
    }
    const restoreDepth = (root: TrashItemRow, visited = new Set<string>()): number => {
      if (visited.has(root.id)) return 0;
      const nextVisited = new Set(visited).add(root.id);
      return Math.max(
        0,
        ...[...(dependenciesByRootId.get(root.id) ?? [])].map((dependencyId) => {
          const dependency = rootsById.get(dependencyId);
          return dependency ? restoreDepth(dependency, nextVisited) + 1 : 0;
        }),
      );
    };
    const orderedRoots = roots
      .map((root, index) => ({ depth: restoreDepth(root), index, root }))
      .sort((left, right) => left.depth - right.depth || left.index - right.index)
      .map(({ root }) => root);

    for (const root of orderedRoots) {
      if (root.rootId) {
        // Children are restored through their root, never on their own.
        outcome.failed.push({ code: 'parentTrashed', id: root.id });
        continue;
      }
      try {
        const restoredRoot = await this.db.transaction(async (tx) => {
          const db = tx as unknown as LobeChatDatabase;
          const registry = new TrashModel(db, this.userId, this.workspaceId);
          // The registry row is the arbiter. Re-read it under lock so a purge
          // claim that won after the list query can never become a fake
          // successful restore with zero affected source rows.
          const lockedRoot = await registry.findActiveRootForUpdate(root.id, tx);
          if (!lockedRoot) return null;
          const children = await registry.findChildren(lockedRoot.id, tx);
          await resolveTrashHandler(lockedRoot.resourceType).restore(
            this.ctx(db),
            lockedRoot,
            children,
          );
          await this.recordResourceAudit(db, tx, lockedRoot, 'resource.restored', {
            batchOperationId,
            occurredAt: restoredAt,
          });
          await registry.removeByIds([lockedRoot.id], tx);
          return lockedRoot;
        });
        if (!restoredRoot) {
          outcome.failed.push({ code: 'notFound', id: root.id });
          continue;
        }
        outcome.restored.push(this.toItem(restoredRoot));
        await this.notifyResourceMutationBestEffort([restoredRoot], 'restored');
      } catch (error) {
        if (error instanceof TrashRestoreError) {
          if (error.code === 'notFound') {
            // Nothing to bring back — drop the stale registry row so the bin
            // stops advertising it. A purge claim has already made its row
            // inactive, so this cannot delete durable storage retry state.
            await this.trashModel.removeActiveByIds([root.id]);
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
    const roots = (
      await this.filterRestrictedRows(await this.trashModel.findByIds(itemIds))
    ).filter((row) => !row.rootId);
    const outcome: TrashPurgeOutcome = { failed: [], purged: 0, purgedIds: [] };
    const found = new Set(roots.map((root) => root.id));
    for (const id of itemIds) {
      if (!found.has(id)) outcome.failed.push({ code: 'notFound', id });
    }
    for (const root of roots) {
      try {
        const purged = await this.purgeRoot(root);
        if (!purged) {
          outcome.failed.push({ code: 'notFound', id: root.id });
          continue;
        }
        outcome.purged += 1;
        outcome.purgedIds.push(root.id);
      } catch (error) {
        log('failed to purge %s:%s: %O', root.resourceType, root.resourceId, error);
        outcome.failed.push({ code: 'purgeFailed', id: root.id });
      }
    }
    return outcome;
  };

  /** Queue every visible root in scope for bounded background deletion. */
  emptyTrash = async (options?: {
    resourceType?: TrashResourceType;
  }): Promise<TrashEmptyOutcome> => {
    const excludeResources = await this.getRestrictedResourceFilter();
    const scheduledIds = await this.trashModel.expireAllRoots({
      excludeResources,
      resourceType: options?.resourceType,
    });

    if (scheduledIds.length > 0) {
      try {
        const accepted = await triggerTrashPurge();
        if (!accepted) throw new Error('Trash purge queue is not configured');
      } catch (error) {
        await this.trashModel.restoreQueuedRoots(scheduledIds);
        log('failed to schedule trash purge; restored %d roots: %O', scheduledIds.length, error);
        throw error;
      }
    }

    return { scheduled: scheduledIds.length };
  };

  private purgeRoot = async (root: TrashItemRow): Promise<boolean> => {
    const claimId = randomUUID();
    const claimedAt = new Date();
    const claimedRoot = await this.trashModel.claimRootForPurge(root.id, {
      claimedAt,
      id: claimId,
      staleBefore: new Date(claimedAt.getTime() - PURGE_CLAIM_TTL_MS),
    });
    if (!claimedRoot) return false;

    const children = await this.trashModel.findChildren(claimedRoot.id);
    // Side effects (S3) and hard deletes are not transactional with each
    // other by nature. The durable registry claim remains the operation's
    // lease across both phases; failures release the lease but retain a
    // restore-block marker so a later purge attempt can retry safely.
    try {
      await resolveTrashHandler(claimedRoot.resourceType).purge(this.ctx(), claimedRoot, children);
      if (!(await this.trashModel.removeClaimedRoot(claimedRoot.id, claimId))) {
        throw new Error('Trash purge claim was lost before registry cleanup');
      }
      log(
        'purged %s:%s (+%d children)',
        claimedRoot.resourceType,
        claimedRoot.resourceId,
        children.length,
      );
      return true;
    } catch (error) {
      await this.trashModel.releasePurgeClaim(claimedRoot.id, claimId);
      throw error;
    }
  };

  private toItem = (row: TrashItemRow): TrashItem => toPublicTrashItem(row);

  // ─────────────────────────── sweep (cron) ───────────────────────────

  /**
   * Hard-delete every root past its `expiresAt`, across all users. Runs as a
   * QStash schedule (see `router-hono/workflows/trash`). Each root is purged
   * under its owner's scope; one failure is logged and skipped so a single
   * poisoned row cannot stall the sweep.
   */
  static sweepExpired = async (
    db: LobeChatDatabase,
    options?: { cursor?: TrashSweepCursor; limit?: number; now?: Date },
  ): Promise<TrashSweepOutcome> => {
    const cursorDate = options?.cursor ? new Date(options.cursor.expiresAt) : undefined;
    const cursor =
      options?.cursor && cursorDate && !Number.isNaN(cursorDate.getTime())
        ? { expiresAt: cursorDate, id: options.cursor.id }
        : undefined;
    const outcome: TrashSweepOutcome = {
      failed: 0,
      nextCursor: null,
      pruned: 0,
      purged: 0,
      scanned: 0,
    };
    const roots = await TrashModel.listExpiredRoots(db, {
      cursor,
      limit: options?.limit ?? TRASH_PURGE_BATCH_SIZE,
      now: options?.now,
    });
    outcome.scanned = roots.length;
    const lastRoot = roots.at(-1);
    outcome.nextCursor = lastRoot
      ? { expiresAt: lastRoot.expiresAt.toISOString(), id: lastRoot.id }
      : null;

    for (const root of roots) {
      const service = new TrashService(db, root.userId, root.workspaceId ?? undefined);
      try {
        if (await service.purgeRoot(root)) outcome.purged += 1;
      } catch (error) {
        outcome.failed += 1;
        log('purge failed for %s:%s — %O', root.resourceType, root.resourceId, error);
      }
    }

    outcome.pruned = await TrashModel.pruneOrphans(db);
    return outcome;
  };
}
