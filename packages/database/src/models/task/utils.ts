import type { NewTask, TaskAutomationMode, TaskAutomationSnapshot } from '@lobechat/types';
import {
  clearTaskReposSelection,
  readTaskExecutionConfig,
  toTaskExecutionConfigPatch,
} from '@lobechat/types';

import { isUniqueViolation } from '../../utils/uniqueViolation';

export const DEFAULT_TASK_IDENTIFIER_PREFIX = 'T';

/** Columns whose change is worth a line in the task activity feed. */
export const TRACKED_TASK_COLUMNS = [
  'assigneeAgentId',
  'assigneeUserId',
  'automationMode',
  // Only for `schedule.maxExecutions`, which lives in the JSONB pocket; the
  // rest of `config` is not diffed.
  'config',
  'heartbeatInterval',
  'priority',
  'schedulePattern',
  'scheduleTimezone',
  'status',
] as const;

/** The automation columns folded into one value — see `TaskAutomationSnapshot`. */
/**
 * The actor columns plus the payload tombstone for one activity row. An
 * agent-driven edit is attributed to the agent, not to the session owner
 * whose credentials it borrowed. Both ids null means the system did it on
 * nobody's behalf (the runner's inbox fallback). `actorKind` repeats that in
 * the payload because the id columns are cleared when the actor is deleted,
 * and "someone who is gone" must not read as "the system".
 */
export const taskActivityActor = (actor: {
  agentId?: string | null;
  userId?: string | null;
}): {
  actorAgentId: string | null;
  actorKind: 'agent' | 'system' | 'user';
  actorUserId: string | null;
} => ({
  actorAgentId: actor.agentId ?? null,
  actorKind: actor.agentId ? 'agent' : actor.userId ? 'user' : 'system',
  actorUserId: actor.agentId ? null : (actor.userId ?? null),
});

export const snapshotAutomation = (row: {
  automationMode: TaskAutomationMode | null;
  config: unknown;
  heartbeatInterval: number | null;
  schedulePattern: string | null;
  scheduleTimezone: string | null;
}): TaskAutomationSnapshot | null => {
  // No mode means automation is off; the leftover pattern / interval columns
  // are configuration in waiting, not something the user turned on.
  if (!row.automationMode) return null;
  const maxExecutions = (row.config as { schedule?: { maxExecutions?: number | null } } | null)
    ?.schedule?.maxExecutions;
  return {
    heartbeatInterval: row.heartbeatInterval,
    maxExecutions: typeof maxExecutions === 'number' ? maxExecutions : null,
    mode: row.automationMode,
    schedulePattern: row.schedulePattern,
    scheduleTimezone: row.scheduleTimezone,
  };
};

// Foreign-key id columns a caller may clear or leave unset. LLM tool calls often
// fill optional ids with "" — that must mean "unset", never reach the FK as ''.
const TASK_NULLABLE_REF_KEYS = ['assigneeAgentId', 'assigneeUserId', 'parentTaskId'] as const;

export const normalizeTaskRefs = <
  T extends Partial<Record<(typeof TASK_NULLABLE_REF_KEYS)[number], unknown>>,
>(
  data: T,
): T => {
  const normalized = { ...data };
  for (const key of TASK_NULLABLE_REF_KEYS) {
    const value = normalized[key];
    if (typeof value === 'string' && !value.trim()) {
      (normalized as Record<string, unknown>)[key] = null;
    }
  }
  return normalized;
};

/**
 * The data to write when a task moves to another assignee, with the previous
 * assignee's cloud-repo selection dropped in the same write.
 *
 * `repos` resolve against the assignee agent's provider env, so they belong to
 * the agent they were picked for: carrying them to another agent leaves every
 * later run pointing at a repository the new assignee cannot open. The
 * machine-local axes (the device pin and a path on that machine) are the user's
 * own and stay.
 *
 * Only a change of the AGENT counts, and only when the write does not state an
 * execution of its own — a writer that moves the assignee AND names a directory
 * is describing the new assignee's run on purpose. Returns `data` untouched when
 * there is nothing to drop.
 */
export const withStaleReposCleared = (
  before: { assigneeAgentId: string | null; config: unknown },
  data: Partial<Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'>>,
): Partial<Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'>> => {
  // Nothing to drop for a task that had no assignee to begin with (the runner's
  // "unassigned → inbox agent" fallback), nor for a write that keeps it.
  if (!before.assigneeAgentId) return data;
  if (data.assigneeAgentId === undefined || data.assigneeAgentId === before.assigneeAgentId) {
    return data;
  }

  const statedExecution = (data.config as Record<string, unknown> | undefined)?.execution;
  if (statedExecution !== undefined) return data;

  const currentConfig = (before.config ?? {}) as Record<string, unknown>;
  const cleared = clearTaskReposSelection(readTaskExecutionConfig(currentConfig));
  if (cleared === readTaskExecutionConfig(currentConfig)) return data;

  return {
    ...data,
    config: {
      ...currentConfig,
      ...(data.config as Record<string, unknown> | undefined),
      execution: toTaskExecutionConfigPatch(cleared),
    },
  };
};

/** Kept under its historical name for callers outside this package. */
export const isTaskIdentifierUniqueViolation = isUniqueViolation;
