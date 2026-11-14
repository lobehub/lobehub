import type { TaskLabelRef, TaskLabelWithUsage } from '@lobechat/types';
import { and, asc, count, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';

import type { TaskLabelItem } from '../schemas';
import { taskLabelLinks, taskLabels, tasks } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { type TaskModelContext, taskOwnership } from './task/context';

/** Thrown for caller mistakes the router maps to BAD_REQUEST / CONFLICT. */
export class TaskLabelError extends Error {
  constructor(
    public readonly code:
      | 'GROUP_CONFLICT'
      | 'GROUP_NOT_ASSIGNABLE'
      | 'INVALID_PARENT'
      | 'LABEL_NOT_FOUND'
      | 'TASK_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'TaskLabelError';
  }
}

export interface CreateTaskLabelParams {
  color?: string | null;
  description?: string | null;
  isGroup?: boolean;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
}

export type UpdateTaskLabelParams = Partial<
  Pick<TaskLabelItem, 'color' | 'description' | 'name' | 'parentId' | 'sortOrder'>
>;

const UUID_PATTERN = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const isUuid = (value: string) => UUID_PATTERN.test(value);

const toRef = (row: Pick<TaskLabelItem, 'color' | 'id' | 'name' | 'parentId'>): TaskLabelRef => ({
  color: row.color,
  id: row.id,
  name: row.name,
  parentId: row.parentId,
});

export class TaskLabelModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly workspaceId?: string;
  private readonly ctx: TaskModelContext;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.ctx = { db, userId, workspaceId };
  }

  // Labels are a workspace-level registry: every member sees and shares the
  // same label set (no per-member visibility). Personal mode falls back to
  // `user_id = ? AND workspace_id IS NULL`.
  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: taskLabels.userId, workspaceId: taskLabels.workspaceId },
    );

  private payload = <T extends object>(value: T) =>
    buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, value);

  // ========== Registry ==========

  /**
   * Every label in scope, groups included, with the number of tasks carrying
   * it. The count only covers tasks the caller can see (task ownership,
   * trash and archive excluded) so it matches what the task list shows rather
   * than revealing how many of a teammate's private tasks use a shared label.
   */
  query = async (): Promise<TaskLabelWithUsage[]> => {
    const rows = await this.db
      .select({
        color: taskLabels.color,
        description: taskLabels.description,
        id: taskLabels.id,
        isGroup: taskLabels.isGroup,
        name: taskLabels.name,
        parentId: taskLabels.parentId,
        sortOrder: taskLabels.sortOrder,
        usageCount: count(tasks.id),
      })
      .from(taskLabels)
      .leftJoin(taskLabelLinks, eq(taskLabelLinks.labelId, taskLabels.id))
      .leftJoin(
        tasks,
        and(eq(tasks.id, taskLabelLinks.taskId), isNull(tasks.archivedAt), taskOwnership(this.ctx)),
      )
      .where(this.ownership())
      .groupBy(taskLabels.id)
      .orderBy(asc(taskLabels.sortOrder), asc(sql`lower(${taskLabels.name})`));

    return rows;
  };

  findById = async (id: string): Promise<TaskLabelItem | undefined> => {
    if (!isUuid(id)) return undefined;
    const [row] = await this.db
      .select()
      .from(taskLabels)
      .where(and(eq(taskLabels.id, id), this.ownership()))
      .limit(1);
    return row;
  };

  findByIds = async (ids: string[]): Promise<TaskLabelItem[]> => {
    // A malformed id simply resolves to nothing instead of an invalid-uuid cast error.
    ids = ids.filter(isUuid);
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(taskLabels)
      .where(and(inArray(taskLabels.id, ids), this.ownership()));
  };

  /** Case-insensitive name lookup; names are unique per scope. */
  findByNames = async (names: string[]): Promise<TaskLabelItem[]> => {
    const lowered = [...new Set(names.map((name) => name.trim().toLowerCase()))].filter(Boolean);
    if (lowered.length === 0) return [];
    return this.db
      .select()
      .from(taskLabels)
      .where(and(inArray(sql`lower(${taskLabels.name})`, lowered), this.ownership()));
  };

  /** Groups nest one level only, and only a group can be a parent. */
  private assertValidParent = async (
    parentId: string | null | undefined,
    isGroup: boolean,
    db: LobeChatDatabase | Transaction = this.db,
  ) => {
    if (!parentId) return;
    if (isGroup) throw new TaskLabelError('INVALID_PARENT', 'A label group cannot be nested');

    const [parent] = isUuid(parentId)
      ? await db
          .select({ isGroup: taskLabels.isGroup })
          .from(taskLabels)
          .where(and(eq(taskLabels.id, parentId), this.ownership()))
          .limit(1)
      : [];
    if (!parent || !parent.isGroup) {
      throw new TaskLabelError('INVALID_PARENT', `Label group not found: ${parentId}`);
    }
  };

  create = async (params: CreateTaskLabelParams): Promise<TaskLabelItem> => {
    const isGroup = params.isGroup ?? false;
    await this.assertValidParent(params.parentId, isGroup);

    const [row] = await this.db
      .insert(taskLabels)
      .values(
        this.payload({
          color: params.color ?? null,
          description: params.description ?? null,
          isGroup,
          name: params.name.trim(),
          parentId: params.parentId ?? null,
          sortOrder: params.sortOrder ?? 0,
        }),
      )
      .returning();

    return row;
  };

  /**
   * Find the labels with these names, creating the missing ones; returns every
   * label named, new or not. An existing label is kept as it is, whatever color
   * or group was asked for, and the first of several with one name decides. A
   * label a concurrent caller just created is found rather than failing, which
   * is what sets this apart from {@link create}.
   */
  findOrCreateMany = async (
    params: Pick<CreateTaskLabelParams, 'color' | 'isGroup' | 'name' | 'parentId'>[],
  ): Promise<TaskLabelItem[]> => {
    // One row per name: callers pass a label per use, which can outgrow the
    // bind parameters a statement may hold.
    const unique = new Map<string, (typeof params)[number]>();
    for (const item of params) {
      const key = item.name.trim().toLowerCase();
      if (!unique.has(key)) unique.set(key, item);
    }
    const items = [...unique.values()];
    if (items.length === 0) return [];
    for (const item of items) {
      await this.assertValidParent(item.parentId, item.isGroup ?? false);
    }

    await this.db
      .insert(taskLabels)
      .values(
        items.map((item) =>
          this.payload({
            color: item.color ?? null,
            isGroup: item.isGroup ?? false,
            name: item.name.trim(),
            parentId: item.parentId ?? null,
          }),
        ),
      )
      .onConflictDoNothing();

    return this.findByNames(items.map((item) => item.name));
  };

  update = async (id: string, value: UpdateTaskLabelParams): Promise<TaskLabelItem | undefined> => {
    const current = await this.findById(id);
    if (!current) throw new TaskLabelError('LABEL_NOT_FOUND', `Label not found: ${id}`);

    const write = async (db: LobeChatDatabase | Transaction) => {
      const [row] = await db
        .update(taskLabels)
        .set({
          ...value,
          ...(value.name !== undefined ? { name: value.name.trim() } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(taskLabels.id, id), this.ownership()))
        .returning();
      return row;
    };

    // No parent in the patch, or moving out of a group: nothing to check.
    if (!value.parentId) return write(this.db);

    // Moving into a group would break "one label per group" on tasks that
    // already carry a sibling, so refuse rather than silently dropping one.
    // The check and the move must not interleave with assignments or another
    // regroup: lock this label (assignments hold FOR SHARE on the labels they
    // attach), decide from its parent *under the lock* (a pre-lock read may be
    // stale), then lock every task carrying it (assignments hold the task row)
    // in the same label → task order assignments use, check, and write.
    const groupId = value.parentId;
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ parentId: taskLabels.parentId })
        .from(taskLabels)
        .where(and(eq(taskLabels.id, id), this.ownership()))
        .for('update');
      if (!locked) throw new TaskLabelError('LABEL_NOT_FOUND', `Label not found: ${id}`);

      if (locked.parentId !== groupId) {
        await this.assertValidParent(groupId, current.isGroup, tx);
        await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            inArray(
              tasks.id,
              tx
                .select({ taskId: taskLabelLinks.taskId })
                .from(taskLabelLinks)
                .where(eq(taskLabelLinks.labelId, id)),
            ),
          )
          .orderBy(asc(tasks.id))
          .for('update');
        await this.assertNoGroupConflict(id, groupId, tx);
      }
      return write(tx);
    });
  };

  private assertNoGroupConflict = async (
    labelId: string,
    groupId: string,
    db: LobeChatDatabase | Transaction,
  ) => {
    const sibling = db
      .select({ taskId: taskLabelLinks.taskId })
      .from(taskLabelLinks)
      .innerJoin(taskLabels, eq(taskLabels.id, taskLabelLinks.labelId))
      .where(and(eq(taskLabels.parentId, groupId), ne(taskLabels.id, labelId)));

    const [conflict] = await db
      .select({ taskId: taskLabelLinks.taskId })
      .from(taskLabelLinks)
      .where(and(eq(taskLabelLinks.labelId, labelId), inArray(taskLabelLinks.taskId, sibling)))
      .limit(1);

    if (conflict) {
      throw new TaskLabelError(
        'GROUP_CONFLICT',
        'Some tasks already carry another label from this group',
      );
    }
  };

  /** Hard delete; links (and, for a group, its labels) go with it via FK cascade. */
  delete = async (id: string) => {
    if (!isUuid(id)) return;
    return this.db.delete(taskLabels).where(and(eq(taskLabels.id, id), this.ownership()));
  };

  // ========== Task assignments ==========

  /** Labels on each of the given tasks, keyed by task id; tasks the caller cannot see are skipped. */
  getLabelsForTasks = async (taskIds: string[]): Promise<Record<string, TaskLabelRef[]>> => {
    if (taskIds.length === 0) return {};

    const rows = await this.db
      .select({
        color: taskLabels.color,
        id: taskLabels.id,
        name: taskLabels.name,
        parentId: taskLabels.parentId,
        sortOrder: taskLabels.sortOrder,
        taskId: taskLabelLinks.taskId,
      })
      .from(taskLabelLinks)
      .innerJoin(taskLabels, eq(taskLabels.id, taskLabelLinks.labelId))
      .innerJoin(tasks, eq(tasks.id, taskLabelLinks.taskId))
      .where(
        and(inArray(taskLabelLinks.taskId, taskIds), this.ownership(), taskOwnership(this.ctx)),
      )
      .orderBy(asc(taskLabels.sortOrder), asc(sql`lower(${taskLabels.name})`));

    const result: Record<string, TaskLabelRef[]> = {};
    for (const row of rows) {
      (result[row.taskId] ??= []).push(toRef(row));
    }
    return result;
  };

  getTaskLabels = async (taskId: string): Promise<TaskLabelRef[]> =>
    (await this.getLabelsForTasks([taskId]))[taskId] ?? [];

  /**
   * Check the task is in the caller's scope and take a row lock on it for the
   * rest of the transaction. The unique index only covers `(task_id, label_id)`, so "one
   * label per group" is a read-then-write invariant: without serializing
   * writers per task, two concurrent attaches of different siblings could
   * each delete the old one and both insert. Holding the task row lock makes
   * the second writer wait, and its sibling DELETE (a fresh READ COMMITTED
   * snapshot) then sees and replaces the first writer's label.
   */
  private lockTaskInScope = async (taskId: string, tx: Transaction) => {
    const [row] = await tx
      .select({ id: tasks.id, userId: tasks.createdByUserId, workspaceId: tasks.workspaceId })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), taskOwnership(this.ctx)))
      .limit(1)
      .for('update', { of: tasks });
    if (!row) throw new TaskLabelError('TASK_NOT_FOUND', `Task not found: ${taskId}`);
    return row;
  };

  /**
   * A link is owned by its task's owner, not by whoever attached it: the
   * `user_id` FK cascades, and a teammate who labelled a shared task leaving
   * must not strip the label. The owner leaving takes the task (and links)
   * with it anyway.
   */
  private linkRow = (
    task: { userId: string; workspaceId: string | null },
    taskId: string,
    labelId: string,
  ) => ({ labelId, taskId, userId: task.userId, workspaceId: task.workspaceId });

  /**
   * Resolve ids to assignable labels: every id must exist in scope, none may
   * be a group, and the set may hold at most one label per group.
   *
   * Inside an assignment transaction pass `tx`: the rows are then read under
   * FOR SHARE, so a concurrent regroup (which locks the label FOR UPDATE)
   * either finishes first and is seen here, or waits for this write and then
   * sees its links. Always taken before the task row lock (label → task).
   */
  private resolveAssignable = async (
    labelIds: string[],
    tx?: Transaction,
  ): Promise<TaskLabelItem[]> => {
    const ids = [...new Set(labelIds)];
    const valid = ids.filter(isUuid);
    const labels =
      tx && valid.length > 0
        ? await tx
            .select()
            .from(taskLabels)
            .where(and(inArray(taskLabels.id, valid), this.ownership()))
            .orderBy(asc(taskLabels.id))
            .for('share')
        : await this.findByIds(ids);

    const found = new Set(labels.map((label) => label.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new TaskLabelError('LABEL_NOT_FOUND', `Labels not found: ${missing.join(', ')}`);
    }

    const group = labels.find((label) => label.isGroup);
    if (group) {
      throw new TaskLabelError(
        'GROUP_NOT_ASSIGNABLE',
        `"${group.name}" is a label group; pick one of its labels`,
      );
    }

    const seenGroups = new Set<string>();
    for (const label of labels) {
      if (!label.parentId) continue;
      if (seenGroups.has(label.parentId)) {
        throw new TaskLabelError(
          'GROUP_CONFLICT',
          'A task can carry only one label from each group',
        );
      }
      seenGroups.add(label.parentId);
    }

    return labels;
  };

  /**
   * Hold these labels for the rest of the transaction, as an assignment does, for a
   * writer that must lock a task before it knows which of them it attaches. Assigning
   * takes labels before the task, so taking them first keeps that order.
   */
  lockForShare = async (labelIds: string[]): Promise<void> => {
    const ids = labelIds.filter(isUuid);
    if (ids.length === 0) return;
    await this.db
      .select({ id: taskLabels.id })
      .from(taskLabels)
      .where(and(inArray(taskLabels.id, ids), this.ownership()))
      .orderBy(asc(taskLabels.id))
      .for('share');
  };

  /** Validate a label set for assignment without writing anything. */
  assertAssignable = async (labelIds: string[]): Promise<void> => {
    await this.resolveAssignable(labelIds);
  };

  /**
   * Attach and detach labels on a task in one transaction, so an edit that
   * swaps labels never commits half-way. Attaching a grouped label replaces
   * whatever sibling from the same group the task already carried (Linear
   * behavior). Removals apply before additions.
   */
  changeTaskLabels = async (
    taskId: string,
    { add = [], remove = [] }: { add?: string[]; remove?: string[] },
  ): Promise<TaskLabelRef[]> => {
    const removeIds = remove.filter(isUuid);

    await this.db.transaction(async (tx) => {
      const labels = add.length > 0 ? await this.resolveAssignable(add, tx) : [];
      const task = await this.lockTaskInScope(taskId, tx);

      if (removeIds.length > 0) {
        await tx
          .delete(taskLabelLinks)
          .where(
            and(eq(taskLabelLinks.taskId, taskId), inArray(taskLabelLinks.labelId, removeIds)),
          );
      }

      if (labels.length === 0) return;

      const groupIds = [
        ...new Set(labels.map((l) => l.parentId).filter((id): id is string => !!id)),
      ];
      if (groupIds.length > 0) {
        const siblings = tx
          .select({ id: taskLabels.id })
          .from(taskLabels)
          .where(inArray(taskLabels.parentId, groupIds));
        await tx.delete(taskLabelLinks).where(
          and(
            eq(taskLabelLinks.taskId, taskId),
            inArray(taskLabelLinks.labelId, siblings),
            notInArray(
              taskLabelLinks.labelId,
              labels.map((l) => l.id),
            ),
          ),
        );
      }

      await tx
        .insert(taskLabelLinks)
        .values(labels.map((label) => this.linkRow(task, taskId, label.id)))
        .onConflictDoNothing();
    });

    return this.getTaskLabels(taskId);
  };

  /** Attach labels to a task; see {@link changeTaskLabels} for group handling. */
  addTaskLabels = async (taskId: string, labelIds: string[]): Promise<TaskLabelRef[]> => {
    if (labelIds.length === 0) return this.getTaskLabels(taskId);
    return this.changeTaskLabels(taskId, { add: labelIds });
  };

  removeTaskLabels = async (taskId: string, labelIds: string[]): Promise<TaskLabelRef[]> =>
    this.changeTaskLabels(taskId, { remove: labelIds });

  /** Replace the task's full label set. */
  setTaskLabels = async (taskId: string, labelIds: string[]): Promise<TaskLabelRef[]> => {
    await this.db.transaction(async (tx) => {
      const labels = await this.resolveAssignable(labelIds, tx);
      const nextIds = labels.map((label) => label.id);
      const task = await this.lockTaskInScope(taskId, tx);

      await tx
        .delete(taskLabelLinks)
        .where(
          nextIds.length > 0
            ? and(eq(taskLabelLinks.taskId, taskId), notInArray(taskLabelLinks.labelId, nextIds))
            : eq(taskLabelLinks.taskId, taskId),
        );

      if (nextIds.length > 0) {
        await tx
          .insert(taskLabelLinks)
          .values(nextIds.map((labelId) => this.linkRow(task, taskId, labelId)))
          .onConflictDoNothing();
      }
    });

    return this.getTaskLabels(taskId);
  };
}
