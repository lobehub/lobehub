import type { TaskItem } from '@lobechat/types';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';

import { taskDependencies, tasks } from '../../schemas/task';
import { depsOwnership, type TaskModelContext, taskOwnership } from './context';

export const removeDependency = async (
  ctx: TaskModelContext,
  taskId: string,
  dependsOnId: string,
): Promise<void> => {
  await ctx.db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.taskId, taskId),
        eq(taskDependencies.dependsOnId, dependsOnId),
        depsOwnership(ctx),
      ),
    );
};

export const getDependencies = async (ctx: TaskModelContext, taskId: string) => {
  return ctx.db
    .select()
    .from(taskDependencies)
    .where(and(eq(taskDependencies.taskId, taskId), depsOwnership(ctx)));
};

export const getDependenciesByTaskIds = async (ctx: TaskModelContext, taskIds: string[]) => {
  if (taskIds.length === 0) return [];
  return ctx.db
    .select()
    .from(taskDependencies)
    .where(and(inArray(taskDependencies.taskId, taskIds), depsOwnership(ctx)));
};

export const getDependents = async (ctx: TaskModelContext, taskId: string) => {
  return ctx.db
    .select()
    .from(taskDependencies)
    .where(and(eq(taskDependencies.dependsOnId, taskId), depsOwnership(ctx)));
};

// Check if all dependencies of a task are completed
export const areAllDependenciesCompleted = async (
  ctx: TaskModelContext,
  taskId: string,
): Promise<boolean> => {
  const result = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.dependsOnId, tasks.id))
    .where(
      and(
        eq(taskDependencies.taskId, taskId),
        eq(taskDependencies.type, 'blocks'),
        ne(tasks.status, 'completed'),
        depsOwnership(ctx),
      ),
    );

  return Number(result[0].count) === 0;
};

/**
 * Batched variant of {@link getUnlockedTasks}: discover every task unblocked
 * by any of `completedTaskIds` with a constant number of queries instead of
 * one dependency walk per completed task.
 */
export const getUnlockedTasksForMany = async (
  ctx: TaskModelContext,
  completedTaskIds: string[],
): Promise<TaskItem[]> => {
  if (completedTaskIds.length === 0) return [];

  // All tasks that depend on any of the completed tasks
  const dependents = await ctx.db
    .select({ taskId: taskDependencies.taskId })
    .from(taskDependencies)
    .where(
      and(
        inArray(taskDependencies.dependsOnId, completedTaskIds),
        eq(taskDependencies.type, 'blocks'),
        depsOwnership(ctx),
      ),
    );
  const dependentIds = [...new Set(dependents.map(({ taskId }) => taskId))];
  if (dependentIds.length === 0) return [];

  // Of those, which still have at least one incomplete blocking dependency
  const blocked = await ctx.db
    .selectDistinct({ taskId: taskDependencies.taskId })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.dependsOnId, tasks.id))
    .where(
      and(
        inArray(taskDependencies.taskId, dependentIds),
        eq(taskDependencies.type, 'blocks'),
        ne(tasks.status, 'completed'),
        depsOwnership(ctx),
      ),
    );
  const blockedIds = new Set(blocked.map(({ taskId }) => taskId));
  const unlockedIds = dependentIds.filter((id) => !blockedIds.has(id));
  if (unlockedIds.length === 0) return [];

  // Only unlock tasks still waiting in backlog
  return ctx.db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.id, unlockedIds), eq(tasks.status, 'backlog'), taskOwnership(ctx)));
};

// Check if all subtasks of a parent task are completed
export const areAllSubtasksCompleted = async (
  ctx: TaskModelContext,
  parentTaskId: string,
): Promise<boolean> => {
  const result = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(tasks)
    .where(
      and(eq(tasks.parentTaskId, parentTaskId), ne(tasks.status, 'completed'), taskOwnership(ctx)),
    );

  return Number(result[0].count) === 0;
};
