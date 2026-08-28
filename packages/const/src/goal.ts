/**
 * Goal lifecycle states.
 *
 * A goal is an independent target entity: it owns its definition (title /
 * requirement), budget, and state machine. Unlike `tasks`, whose status is
 * about execution, a goal's status is about the whole acceptance loop —
 * including human review (`review`) and the terminal `achieved` outcome.
 */
export const goalStatuses = [
  'planning',
  'running',
  'verifying',
  'review',
  'paused',
  'achieved',
  'failed',
  'canceled',
] as const;

export type GoalStatus = (typeof goalStatuses)[number];

/**
 * The execution carrier a goal is optionally bound to. Kept polymorphic so a
 * goal does not depend on any single execution model:
 *
 * - `task`       — the current `/goal` flow: the goal runs inside a dedicated task.
 * - `topic`      — a goal declared directly in a conversation (the topic is the carrier).
 * - `standalone` — a pure goal declaration with no execution carrier attached.
 *
 * `null` means no carrier has been bound yet.
 */
export const goalSubjectTypes = ['task', 'topic', 'standalone'] as const;

export type GoalSubjectType = (typeof goalSubjectTypes)[number];
