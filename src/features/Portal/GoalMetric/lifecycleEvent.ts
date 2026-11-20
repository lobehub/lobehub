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
  | 'paused'
  | 'resumed'
  | 'taskCanceled'
  | `work.${GoalNodeWorkVersionRelation}`;

export type LifecycleNote =
  | { key: 'budgetExhausted' | 'recoveredAbandoned' | 'retryAfterVerification' }
  | { key: 'mainAgent'; text: string }
  | { text: string };

const ATTACHED_WORK = /^Attached Work version (\S+) as (input|produced|supports|contradicts)$/;
/** `GoalService.gateOrTakeOver` appends the main Agent's diagnosis this way. */
const MAIN_AGENT = ' — main Agent: ';
const TASK_CANCELED = 'Task canceled';
const BUDGET_EXHAUSTED = 'Goal or main Agent turn budget exhausted';

/** Fixed coordinator reasons that carry meaning, shown in the reader's language. */
const KNOWN_NOTES: Record<string, 'recoveredAbandoned' | 'retryAfterVerification'> = {
  'Automatically started the next Task attempt after verification feedback':
    'retryAfterVerification',
  'Recovered an abandoned Task operation and started the next attempt': 'recoveredAbandoned',
};

/** Reasons that only restate what the row's verb already says. */
const REDUNDANT_REASONS = new Set([
  'Goal achieved',
  'Goal-level acceptance passed',
  'Responsible task completed',
  'paused by user',
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
  const reason = event.reason?.trim();
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
  if (event.entityType === 'goal' && event.eventType === 'activated' && reason === 'resumed by user')
    return { action: 'resumed' };

  if (REDUNDANT_REASONS.has(reason)) return {};
  if (KNOWN_NOTES[reason]) return { note: { key: KNOWN_NOTES[reason] } };

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
