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

/**
 * `actorId` the coordinator stamps on the graph transitions it makes itself.
 *
 * Goal events used to record every transition as the goal's owner, because the
 * model falls back to its `userId`. That made the coordinator's own moves
 * indistinguishable from the user's, and "what did the system decide on its own"
 * unanswerable — a stable id for the one non-human actor is what separates them.
 */
export const GOAL_COORDINATOR_ACTOR_ID = 'goal-coordinator';

/**
 * Fixed title of the terminal Goal-acceptance Work the coordinator creates
 * once every other Work is terminal. Stored in English as data; clients
 * recognize it and render the localized copy (`goalProcess.node.terminalAcceptance`).
 */
export const GOAL_ACCEPTANCE_TASK_TITLE = 'Complete full Goal acceptance';
