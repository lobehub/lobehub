import type { GoalGraphEvent, GoalNodeWorkVersionRelation } from '@lobechat/types';

/**
 * How one goal event reads in the timeline.
 *
 * Events only carry a free-text `reason`, and much of it is coordinator
 * bookkeeping written for logs ("Attached Work version <uuid> as produced",
 * "Responsible task completed"). This turns the reasons the coordinator writes
 * verbatim into something a person can read: a verb that already says what
 * happened, the note worth keeping, or nothing at all when the row adds no
 * information. A reason it does not recognise is kept as written.
 */
export type LifecyclePresentation =
  | { hidden: true }
  | {
      /** Overrides the generic "<verb> <kind>" action. */
      action?: LifecycleAction;
      hidden?: false;
      /** The note under the row; `undefined` drops the raw reason. */
      note?: LifecycleNote;
      /** A Work version the event attached, to show as the row's object. */
      workVersion?: { id: string; relation: GoalNodeWorkVersionRelation };
    };

export type LifecycleAction =
  'paused' | 'resumed' | 'taskCanceled' | `work.${GoalNodeWorkVersionRelation}`;

export type LifecycleNote =
  | { key: 'budgetExhausted' | KnownNoteKey }
  | { detail: string; key: DetailNoteKey }
  | { detail: string; key: 'experimentLimit'; max: string; used: string }
  | { key: 'mainAgent'; text: string }
  | { key: 'retiredWithPrerequisite'; title: string }
  | { count: number; key: 'revisionLimit' }
  | { text: string };

const ATTACHED_WORK = /^Attached Work version (\S+) as (input|produced|supports|contradicts)$/;
/** `GoalService.gateOrTakeOver` appends the main Agent's diagnosis this way. */
const MAIN_AGENT = ' — main Agent: ';
const TASK_CANCELED = 'Task canceled';
const BUDGET_EXHAUSTED = 'Goal or main Agent turn budget exhausted';
/** The CLI hint a paused main Agent turn appends; the page has its own resume control. */
const RESUME_HINT = /\. Resume with: lh goal resume \S+$/;
/** Generated reasons that only restate the row or the node row written with it. */
const REDUNDANT_PATTERNS = [
  /^dispatched \S+$/,
  /^status \S+ → \S+$/,
  /^decision "[\S\s]*" resolved: \S+$/,
];
const BOUND_TO_TOPIC =
  /^bound to topic \S+(?: \(moved from (\S+) \S+\))?(?:; goal agent (\S+) → \S+)?$/;
const DEADLINE_PASSED = /^Deadline passed \(.*\); no new Task will be dispatched$/;
const EXPERIMENT_LIMIT =
  /^Experiment limit reached \((\d+)\/(\d+)\); goal is not yet accepted\. ([\S\s]*)$/;
const REPORT_WRITING = /^Writing the Goal report \(.*\)$/;
const RETIRED_WITH_PREREQUISITE = /^Retired with its prerequisite "([\S\s]*)"$/;
const REVISION_LIMIT =
  /^Experiment \S+ already ran (\d+) corrected protocols; the planner asked for another\. Resume to replan\.$/;

type KnownNoteKey =
  | 'deadlinePassed'
  | 'decisionPending'
  | 'descriptionRefined'
  | 'explorationBudget'
  | 'explorationFailed'
  | 'foldedIntoBatch'
  | 'goalRenamed'
  | 'lateRunUnstoppable'
  | 'measurementCleared'
  | 'noEligibleTask'
  | 'planRevisionFailed'
  | 'planSentBack'
  | 'recipeSuperseded'
  | 'recoveredAbandoned'
  | 'releaseApproved'
  | 'reportSubmitted'
  | 'reportWriting'
  | 'retryAfterVerification'
  | 'stoppingBeforeClose'
  | 'stoppingBeforeDelete'
  | 'taskMissing'
  | 'agentChanged'
  | 'topicMoved';

type DetailNoteKey = 'measuredNotMet' | 'patternBreak' | 'releaseReview';

/** A fixed prefix the coordinator puts before a generated detail. */
const DETAIL_PREFIXES: [prefix: string, key: DetailNoteKey][] = [
  ['Batch pattern break needs a decision: ', 'patternBreak'],
  ['Batch release needs approval: ', 'releaseReview'],
  ['Measured acceptance not met: ', 'measuredNotMet'],
];

/** Fixed coordinator reasons that carry meaning, shown in the reader's language. */
const KNOWN_NOTES: Record<string, KnownNoteKey> = {
  'A planning run that started after the Goal was closed could not be stopped; close the Goal again to stop it':
    'lateRunUnstoppable',
  'Automatically started the next Task attempt after verification feedback':
    'retryAfterVerification',
  'Budget exhausted before graph exploration': 'explorationBudget',
  'Exploration planning failed; resume to retry.': 'explorationFailed',
  'Folded into the batch before start': 'foldedIntoBatch',
  'Goal report submitted': 'reportSubmitted',
  'Goal renamed': 'goalRenamed',
  'Plan sent back to the main Agent': 'planSentBack',
  'Planner refined the description': 'descriptionRefined',
  'Recovered an abandoned Task operation and started the next attempt': 'recoveredAbandoned',
  'Release approved': 'releaseApproved',
  'Responsible task is missing': 'taskMissing',
  'Stopping Goal before closing': 'stoppingBeforeClose',
  'Stopping Goal before deletion': 'stoppingBeforeDelete',
  'The main Agent could not take the plan revision; resume the goal once it can, and the correction goes to it again':
    'planRevisionFailed',
  'a decision gate is open': 'decisionPending',
  'a measurement cleared the acceptance gate': 'measurementCleared',
  'no eligible task to advance': 'noEligibleTask',
  'superseded by a new recipe revision': 'recipeSuperseded',
};

/** Reasons the coordinator generates from a fixed template, in the reader's language. */
const presentGeneratedReason = (reason: string): LifecyclePresentation | undefined => {
  if (REDUNDANT_PATTERNS.some((pattern) => pattern.test(reason))) return {};

  const bound = BOUND_TO_TOPIC.exec(reason);
  if (bound) {
    const [, movedFrom, previousAgent] = bound;
    if (previousAgent && previousAgent !== 'none') return { note: { key: 'agentChanged' } };
    if (movedFrom === 'topic') return { note: { key: 'topicMoved' } };
    // A goal's first binding to its conversation is plumbing, not a change.
    return { hidden: true };
  }

  if (DEADLINE_PASSED.test(reason)) return { note: { key: 'deadlinePassed' } };
  if (REPORT_WRITING.test(reason)) return { note: { key: 'reportWriting' } };

  const experimentLimit = EXPERIMENT_LIMIT.exec(reason);
  if (experimentLimit) {
    const [, used, max, detail] = experimentLimit;
    return { note: { detail, key: 'experimentLimit', max, used } };
  }

  const revisionLimit = REVISION_LIMIT.exec(reason);
  if (revisionLimit) return { note: { count: Number(revisionLimit[1]), key: 'revisionLimit' } };

  const retired = RETIRED_WITH_PREREQUISITE.exec(reason);
  if (retired) return { note: { key: 'retiredWithPrerequisite', title: retired[1] } };

  for (const [prefix, key] of DETAIL_PREFIXES)
    if (reason.startsWith(prefix)) return { note: { detail: reason.slice(prefix.length), key } };

  return undefined;
};

/**
 * Reasons that only restate the row: its verb, its actor, or the node row
 * written in the same step.
 */
const REDUNDANT_REASONS = new Set([
  'Goal achieved',
  'Goal-level acceptance passed',
  'Responsible task completed',
  'Started by the goal agent',
  'Started by the owner',
  'automatic recovery started a run',
  'decomposition claimed',
  'nodes retired by user',
  'paused by user',
  'reclaimed an abandoned Task',
  'resumed by user',
]);

/** The failure itself, and the main Agent's diagnosis when one was attached. */
const splitDiagnosis = (reason: string) => {
  const at = reason.indexOf(MAIN_AGENT);
  if (at < 0) return { failure: reason };
  return { diagnosis: reason.slice(at + MAIN_AGENT.length).trim(), failure: reason.slice(0, at) };
};

export interface LifecycleContext {
  /**
   * Whether a node event at the same moment carries the same reason. A failure
   * gate moves the task node and the goal in one step with one reason, so the
   * goal row would only repeat the task row.
   */
  hasNodeTwin: boolean;
  /** Type of the Work behind a Work version id, when the graph joined it. */
  workTypeOf: (workVersionId: string) => string | undefined;
}

export const presentLifecycleEvent = (
  event: Pick<GoalGraphEvent, 'entityType' | 'eventType' | 'reason'>,
  { hasNodeTwin, workTypeOf }: LifecycleContext,
): LifecyclePresentation => {
  const reason = event.reason?.trim().replace(RESUME_HINT, '');
  if (!reason) return {};

  const attached = ATTACHED_WORK.exec(reason);
  if (attached) {
    const [, id, relation] = attached;
    // A task's own `task` Work is how the run registers itself, not something
    // it delivered — the task row already says the task exists.
    if (workTypeOf(id) === 'task') return { hidden: true };
    return {
      action: `work.${relation as GoalNodeWorkVersionRelation}`,
      workVersion: { id, relation: relation as GoalNodeWorkVersionRelation },
    };
  }

  if (event.entityType === 'goal' && event.eventType === 'updated') {
    if (hasNodeTwin) return { hidden: true };
    if (reason === 'paused by user') return { action: 'paused' };
    if (reason === BUDGET_EXHAUSTED) return { action: 'paused', note: { key: 'budgetExhausted' } };
  }
  if (
    event.entityType === 'goal' &&
    event.eventType === 'activated' &&
    reason === 'resumed by user'
  )
    return { action: 'resumed' };

  if (REDUNDANT_REASONS.has(reason)) return {};
  if (KNOWN_NOTES[reason]) return { note: { key: KNOWN_NOTES[reason] } };

  const generated = presentGeneratedReason(reason);
  if (generated) return generated;

  const { diagnosis, failure } = splitDiagnosis(reason);
  if (event.entityType === 'node' && failure === TASK_CANCELED)
    return {
      action: 'taskCanceled',
      ...(diagnosis ? { note: { key: 'mainAgent', text: diagnosis } } : {}),
    };
  if (diagnosis) return { note: { text: `${failure}\n${diagnosis}` } };

  return { note: { text: reason } };
};

/**
 * Keys node events by moment + reason so a goal event can tell it only
 * repeats one. Second precision: both rows are written in the same step.
 */
export const nodeTwinKey = (event: Pick<GoalGraphEvent, 'createdAt' | 'reason'>) =>
  `${Math.floor(event.createdAt.getTime() / 1000)}|${event.reason ?? ''}`;
