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
 * Fixed title of the decision node the coordinator opens when decomposition
 * finds a question only the user can answer. Stored in English as data and
 * matched by clients for localized copy, the same way as the acceptance title.
 */
export const GOAL_CLARIFICATION_TITLE = 'Clarify the goal';

/**
 * Fixed title of the decision node the coordinator opens when a machine problem
 * needs a person: the setup is broken (a missing working directory, a CLI that is
 * not installed, an unregistered device) or the automatic retries for a usage
 * limit or a transport fault are spent. Nothing about the work is in question, so
 * clients tell it apart from a judgment gate by this title, the same way as the
 * clarification gate.
 */
export const GOAL_MACHINE_GATE_TITLE = 'Fix the setup, then retry';

/**
 * Fixed title of the decision node the main Agent opens when an ordinary
 * planning turn escalates a question with its own answers. Matched by clients
 * for localized copy, like the clarification title.
 */
export const GOAL_MANAGER_QUESTION_TITLE = 'Answer the main Agent';

/**
 * `briefs.trigger` of every brief a goal raises — its decision gates, its
 * sign-off and its progress reports. `metadata.goal` says which one it is.
 */
export const GOAL_BRIEF_TRIGGER = 'goal';

/** Option ids every clarification decision carries besides the planner's own choices. */
export const GOAL_CLARIFICATION_OPTION = {
  /** Answer in the free-text note; the note is the answer. */
  answer: 'answer',
  /** Proceed on the assumption the planner stated for this question. */
  assume: 'assume',
} as const;

/**
 * Task error strings the Goal coordinator matches on to route a paused Task.
 *
 * These are a contract between whoever pauses a Task and the coordinator that
 * reads it back, not user-facing copy. A string with no branch here falls
 * through to the human decision gate, so an unmatched infrastructure failure
 * stops a long-horizon goal until a person clicks retry.
 */
export const LEASE_EXPIRED_ERROR = 'Goal Task operation lease expired.';
/**
 * Prefix of the error the runtime writes when the gateway's inactivity watchdog
 * abandons a run whose worker went silent (a device that slept or restarted, a
 * CLI that died). The run is lost exactly the way an expired lease is, so the
 * coordinator recovers it the same way instead of asking a person.
 */
export const ABANDONED_OPERATION_ERROR_PREFIX = 'Operation abandoned:';
/**
 * `task_topics.status` of a run that ended because its device was unavailable:
 * the dispatch could not reach it, or the run was lost while the device was
 * offline. Nothing judged the work, so the Goal coordinator does not charge the
 * run to the Task's attempt budget and retries it on its own offline schedule.
 */
export const DEVICE_OFFLINE_RUN_STATUS = 'device_offline';
/**
 * `task_topics.status` of a run that ended on a provider or CLI usage limit
 * ("You've hit your session limit · resets 4:30am"). The limit resets on its own
 * and nothing judged the work, so the run is not charged to the attempt budget;
 * the coordinator holds the Task until the reset and retries it.
 */
export const QUOTA_LIMITED_RUN_STATUS = 'quota_limited';
/**
 * `task_topics.status` of a run lost to a transport or runtime fault a retry
 * plausibly fixes (a timeout, an output the server discarded, a write that did
 * not persist). Not charged to the attempt budget; retried on a short bounded
 * schedule before a person is asked.
 */
export const TRANSIENT_FAILED_RUN_STATUS = 'transient_failed';
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
/**
 * The delivery's own verifiers ran and passed, but the Acceptance review layered
 * on top of them could not run — a provider outage that outlived the in-place
 * retry, a reviewer without credentials, an artifact the review model could not
 * open.
 *
 * Deliberately has NO recovery branch. Recovering it like a rejection started a
 * fresh builder attempt, which re-delivered into the same broken review and spent
 * the Task's attempt budget without the delivery ever being judged.
 */
export const ACCEPTANCE_REVIEW_ERRORED_ERROR =
  'Acceptance review could not run; the delivery passed its verifiers but was never reviewed.';

/**
 * Fixed title of the wrap-up Task the coordinator dispatches once the
 * Goal-level acceptance has ended (passed, failed / exhausted, or the Goal was
 * failed / canceled). It writes the Goal report storyline. Stored in English as
 * data; clients recognize it by this title. It never takes part in deciding the
 * Goal's status — the coordinator ignores it when choosing its next move.
 */
export const GOAL_REPORT_TASK_TITLE = 'Write the Goal report';
