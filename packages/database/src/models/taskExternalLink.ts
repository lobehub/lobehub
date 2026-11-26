import type { TaskExternalProvider } from '@lobechat/types';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { NewTaskExternalLink, TaskExternalLinkItem } from '../schemas';
import { taskExternalLinks, tasks } from '../schemas';
import type { LobeChatDatabase } from '../type';

export type TaskExternalLinkCreate = Omit<
  NewTaskExternalLink,
  'createdAt' | 'id' | 'updatedAt' | 'userId' | 'workspaceId'
>;

export type TaskExternalLinkWithTask = TaskExternalLinkItem & { taskIdentifier: string };

/**
 * Links between tasks and the external items they were imported from, scoped
 * like tasks: the workspace's links, or the user's personal ones. An external
 * item maps to at most one task per scope.
 */
export class TaskExternalLinkModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /** Links for the given external ids, with the linked task's display identifier. */
  async findByExternalIds(
    provider: TaskExternalProvider,
    externalIds: string[],
  ): Promise<TaskExternalLinkWithTask[]> {
    if (externalIds.length === 0) return [];
    return this.selectWithTask().where(
      and(
        this.scope(),
        eq(taskExternalLinks.provider, provider),
        inArray(taskExternalLinks.externalId, externalIds),
      ),
    );
  }

  /** Every link in one external container (a Linear team). */
  async findByContainer(
    provider: TaskExternalProvider,
    containerId: string,
  ): Promise<TaskExternalLinkWithTask[]> {
    return this.selectWithTask().where(
      and(
        this.scope(),
        eq(taskExternalLinks.provider, provider),
        eq(taskExternalLinks.externalContainerId, containerId),
      ),
    );
  }

  async findByTaskId(taskId: string): Promise<TaskExternalLinkItem | null> {
    const [row] = await this.db
      .select()
      .from(taskExternalLinks)
      .where(and(this.scope(), eq(taskExternalLinks.taskId, taskId)));
    return row ?? null;
  }

  async create(data: TaskExternalLinkCreate): Promise<TaskExternalLinkItem> {
    const [row] = await this.db
      .insert(taskExternalLinks)
      .values({ ...data, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .returning();
    return row;
  }

  async update(
    id: string,
    data: Partial<
      Pick<
        TaskExternalLinkItem,
        | 'externalContainerId'
        | 'externalIdentifier'
        | 'externalUpdatedAt'
        | 'externalUrl'
        | 'metadata'
        | 'syncedHash'
      >
    >,
  ): Promise<void> {
    const { metadata, ...rest } = data;
    await this.db
      .update(taskExternalLinks)
      .set({
        ...rest,
        // Display metadata is replaced, but the comment and label bookkeeping a
        // sync recorded is kept: read and written in the row update itself, so a
        // refresh working from an older read never drops what was recorded since.
        ...(metadata
          ? {
              metadata: sql`jsonb_strip_nulls(jsonb_build_object('commentsSynced', ${taskExternalLinks.metadata} -> 'commentsSynced', 'syncedCommentIds', ${taskExternalLinks.metadata} -> 'syncedCommentIds', 'syncedLabels', ${taskExternalLinks.metadata} -> 'syncedLabels')) || ${JSON.stringify(metadata)}::jsonb`,
            }
          : {}),
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(this.scope(), eq(taskExternalLinks.id, id)));
  }

  /**
   * Record that the issue's comments were synced, adding the ids of those
   * copied onto the link's task (possibly none) so they are not copied again.
   */
  async recordSyncedComments(id: string, commentIds: string[]): Promise<void> {
    await this.db
      .update(taskExternalLinks)
      .set({
        metadata: sql`jsonb_set(jsonb_set(${taskExternalLinks.metadata}, '{syncedCommentIds}', coalesce(${taskExternalLinks.metadata} -> 'syncedCommentIds', '[]'::jsonb) || ${JSON.stringify(commentIds)}::jsonb), '{commentsSynced}', 'true'::jsonb)`,
        updatedAt: new Date(),
      })
      .where(and(this.scope(), eq(taskExternalLinks.id, id)));
  }

  /** Record the issue's labels as applied to the link's task. */
  async recordSyncedLabels(id: string, labels: string[]): Promise<void> {
    await this.db
      .update(taskExternalLinks)
      .set({
        metadata: sql`jsonb_set(${taskExternalLinks.metadata}, '{syncedLabels}', ${JSON.stringify(labels)}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(and(this.scope(), eq(taskExternalLinks.id, id)));
  }

  private selectWithTask() {
    return this.db
      .select({
        accessedAt: taskExternalLinks.accessedAt,
        createdAt: taskExternalLinks.createdAt,
        externalContainerId: taskExternalLinks.externalContainerId,
        externalId: taskExternalLinks.externalId,
        externalIdentifier: taskExternalLinks.externalIdentifier,
        externalUpdatedAt: taskExternalLinks.externalUpdatedAt,
        externalUrl: taskExternalLinks.externalUrl,
        id: taskExternalLinks.id,
        lastSyncedAt: taskExternalLinks.lastSyncedAt,
        metadata: taskExternalLinks.metadata,
        provider: taskExternalLinks.provider,
        syncedHash: taskExternalLinks.syncedHash,
        taskId: taskExternalLinks.taskId,
        taskIdentifier: tasks.identifier,
        updatedAt: taskExternalLinks.updatedAt,
        userId: taskExternalLinks.userId,
        workspaceId: taskExternalLinks.workspaceId,
      })
      .from(taskExternalLinks)
      .innerJoin(tasks, eq(tasks.id, taskExternalLinks.taskId))
      .$dynamic();
  }

  private scope() {
    return this.workspaceId
      ? eq(taskExternalLinks.workspaceId, this.workspaceId)
      : and(eq(taskExternalLinks.userId, this.userId), isNull(taskExternalLinks.workspaceId));
  }
}
