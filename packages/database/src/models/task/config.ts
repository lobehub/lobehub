import type { CheckpointConfig, TaskItem, TaskVerifyConfig } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { tasks } from '../../schemas/task';
import type { LobeChatDatabase } from '../../type';
import { type TaskModelContext, taskOwnership } from './context';
import { writeRow } from './rows';

/**
 * Read-modify-write of the `config` column under a row lock. Every writer that
 * derives the next config from the current one must come through here, so two
 * of them cannot read the same snapshot and drop each other's key.
 */
export const rewriteConfig = async (
  ctx: TaskModelContext,
  id: string,
  next: (current: Record<string, any>) => Record<string, unknown>,
): Promise<TaskItem | null> => {
  return ctx.db.transaction(async (tx) => {
    const runner = tx as LobeChatDatabase;
    const [task] = await runner
      .select({ config: tasks.config })
      .from(tasks)
      .where(and(eq(tasks.id, id), taskOwnership(ctx)))
      .for('update')
      .limit(1);
    if (!task) return null;

    return writeRow(ctx, runner, id, {
      config: next((task.config as Record<string, any>) || {}),
    });
  });
};

/**
 * Patch the task's own `config.verify`. Per-key semantics (a plain deep-merge
 * can't express "remove", and JSON can't transmit `undefined`):
 * - `null`      → clear the key (e.g. switch a rubric/verifier back to default)
 * - omitted     → leave the existing value untouched
 * - any value   → set it (arrays replace wholesale, not index-merged)
 *
 * The merge is scoped to the `verify` sub-object so sibling config keys
 * (model, checkpoint, schedule, …) are preserved.
 */
export const updateVerifyConfig = async (
  ctx: TaskModelContext,
  id: string,
  patch: { [K in keyof TaskVerifyConfig]?: TaskVerifyConfig[K] | null },
): Promise<TaskItem | null> => {
  return rewriteConfig(ctx, id, (config) => {
    const next: Record<string, any> = { ...(config.verify as TaskVerifyConfig | undefined) };

    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = value;
    }

    return { ...config, verify: next };
  });
};

export const getCheckpointConfig = (task: TaskItem): CheckpointConfig => {
  return (task.config as Record<string, any>)?.checkpoint || {};
};

export const getReviewConfig = (task: TaskItem): Record<string, any> | undefined => {
  return (task.config as Record<string, any>)?.review;
};

/**
 * Read this task's own verify config from `config.verify`. During the
 * migration window it falls back to the legacy `config.review` key so tasks
 * configured before the verify cutover still surface their gate settings —
 * only the shared `enabled` / `maxIterations` fields carry over (review's
 * inline rubrics are dropped, no data was using them).
 */
export const getVerifyConfig = (task: TaskItem): TaskVerifyConfig | undefined => {
  const config = task.config as Record<string, any> | undefined;
  if (config?.verify) return config.verify as TaskVerifyConfig;

  const review = config?.review as Record<string, any> | undefined;
  if (review && (review.enabled !== undefined || review.maxIterations !== undefined)) {
    return { enabled: review.enabled, maxIterations: review.maxIterations };
  }
  return undefined;
};
