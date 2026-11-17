import type { TrashItem, TrashProjectFilter } from '@lobechat/types';
import { TRASH_RESOURCE_TYPES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import type { LobeChatDatabase } from '@/database/type';
import { trashRouter } from '@/server/routers/lambda/trash';

import { BaseService } from '../common/base.service';
import { DEFAULT_PAGE_LIMIT } from '../helpers/pagination';
import type {
  EmptyTrashRequest,
  TrashCountsQuery,
  TrashItemResponse,
  TrashListQuery,
} from '../types/trash.type';
import { TRASH_NO_PROJECT } from '../types/trash.type';

const toIso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);

/** The query-string project filter onto the service's `undefined | null | id`. */
const toProjectFilter = (projectId: string | undefined): TrashProjectFilter =>
  projectId === TRASH_NO_PROJECT ? null : projectId;

/**
 * The public row: the display snapshot only. Restore bookkeeping kept in
 * `meta` (a message's original tree, a topic's file-removal flag) and the
 * internal cascade link stay on the server.
 */
const toTrashItem = (item: TrashItem): TrashItemResponse => {
  const meta = item.meta;
  return {
    deletedAt: toIso(item.deletedAt),
    deletedByUserId: item.deletedByUserId,
    expiresAt: toIso(item.expiresAt),
    id: item.id,
    meta: meta
      ? Object.fromEntries(
          Object.entries({
            avatar: meta.avatar,
            backgroundColor: meta.backgroundColor,
            childCount: meta.childCount,
            kind: meta.kind,
            parentTitle: meta.parentTitle,
            private: meta.private,
            role: meta.role,
            size: meta.size,
          }).filter(([, value]) => value !== undefined),
        )
      : null,
    resourceId: item.resourceId,
    resourceType: item.resourceType,
    title: item.title,
    workspaceId: item.workspaceId,
  };
};

/**
 * The recycle bin for the REST API. Every call goes through the shared
 * `trash` procedures, so the bin's rules are the in-app ones: a personal bin
 * holds only the caller's rows; in a workspace each member manages what they
 * deleted, owners and admins also manage the public side, and nobody else
 * reaches a member's private deletions. The procedures read the workspace
 * role from the context, which the REST workspace middleware resolved.
 */
export class TrashRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string; workspaceRole?: string };

  constructor(
    db: LobeChatDatabase,
    userId: string | null,
    workspaceId?: string,
    workspaceRole?: string,
  ) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId, workspaceRole };
  }

  private get trash() {
    return trashRouter.createCaller(this.ctx);
  }

  /** Shared guards throw `TRPCError`; the controller maps its code to the HTTP status. */
  private fail(error: unknown, operation: string): never {
    if (error instanceof TRPCError) throw error;
    this.handleServiceError(error, operation);
  }

  async list(query: TrashListQuery) {
    try {
      const result = await this.trash.list({
        cursor: query.cursor,
        limit: query.limit ?? DEFAULT_PAGE_LIMIT,
        projectId: toProjectFilter(query.projectId),
        resourceType: query.resourceType,
        visibility: query.visibility,
      });
      return {
        hasMore: !!result.nextCursor,
        items: result.items.map(toTrashItem),
        nextCursor: result.nextCursor,
      };
    } catch (error) {
      this.fail(error, 'list trash');
    }
  }

  async counts(query: TrashCountsQuery) {
    try {
      const counts = await this.trash.countByType({
        projectId: toProjectFilter(query.projectId),
        visibility: query.visibility,
      });
      const byType = Object.fromEntries(
        TRASH_RESOURCE_TYPES.map((type) => [type, counts[type] ?? 0]),
      ) as Record<(typeof TRASH_RESOURCE_TYPES)[number], number>;
      return { byType, total: Object.values(byType).reduce((sum, count) => sum + count, 0) };
    } catch (error) {
      this.fail(error, 'count trash');
    }
  }

  async restore(ids: string[]) {
    try {
      const { failed, restored } = await this.trash.restore({ ids });
      return { failed, restored: restored.map(toTrashItem) };
    } catch (error) {
      this.fail(error, 'restore trash');
    }
  }

  async purge(ids: string[]) {
    try {
      return await this.trash.purge({ ids });
    } catch (error) {
      this.fail(error, 'purge trash');
    }
  }

  async empty(body: EmptyTrashRequest) {
    try {
      return await this.trash.emptyTrash({
        projectId: toProjectFilter(body.projectId),
        resourceType: body.resourceType,
        visibility: body.visibility,
      });
    } catch (error) {
      this.fail(error, 'empty trash');
    }
  }
}
