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

/**
 * Task error strings the Goal coordinator matches on to route a paused Task.
 *
 * These are a contract between whoever pauses a Task and the coordinator that
 * reads it back, not user-facing copy. A string with no branch here falls
 * through to the human decision gate, so an unmatched infrastructure failure
 * stops a long-horizon goal until a person clicks retry.
 */
export const LEASE_EXPIRED_ERROR = 'Goal Task operation lease expired.';
/** The verifier ran and judged the delivery short of the criteria. */
export const VERIFICATION_FAILED_ERROR = 'Delivery did not pass verification.';
/** The verifier itself could not run, so the delivery was never evaluated. */
export const VERIFICATION_ERRORED_ERROR =
  'Verification could not run (internal error); the delivery was not evaluated.';
/**
 * The review read the evidence and found the criterion undecidable from it — it
 * asks for an action the review layer cannot perform (re-running the delivered
 * scripts, building, driving a live system).
 *
 * Deliberately has NO recovery branch, so it falls through to the human gate.
 * Another attempt cannot help: the builder would re-deliver the same artifacts
 * against the same unprovable criterion, which is how one such check ate an
 * entire attempt budget before this outcome existed.
 */
export const VERIFICATION_UNJUDGEABLE_ERROR =
  'Acceptance review could not judge the delivery from evidence alone; the criterion needs a judge that can act on the system.';
