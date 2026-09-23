import { readHeterogeneousInterventionDeadline, type ToolIntervention } from '@lobechat/types';
import { useEffect, useMemo, useState } from 'react';

import { type PendingIntervention } from '../store/slices/data/pendingInterventions';

/**
 * A clock that ticks exactly when the next of `deadlines` passes, and at no
 * other time.
 *
 * `getPendingInterventions` drops a question whose producer deadline has
 * passed, but only when something re-runs it — selector results are memoized
 * on store identity, and nothing in the store changes at the deadline. A card
 * whose form never writes at expiry (provider-owned options deliberately skip
 * the auto-answer) would otherwise stay on screen, unanswerable, until some
 * unrelated update happened to recompute the list.
 *
 * The returned `now` only moves forward at a deadline, so it may lag the wall
 * clock in between; that is safe because anything already past its deadline
 * when the list was selected was dropped by the selector itself.
 */
export const useDeadlineClock = (deadlines: readonly (number | undefined)[]): number => {
  const [now, setNow] = useState(() => Date.now());

  let next: number | undefined;
  for (const deadline of deadlines) {
    if (deadline !== undefined && deadline > now && (next === undefined || deadline < next)) {
      next = deadline;
    }
  }

  useEffect(() => {
    if (next === undefined) return;
    // Clamp forward to the deadline itself: a timer that fires a hair early
    // must still expire the card, or `next` would not change and nothing would
    // re-arm.
    const id = setTimeout(() => setNow(Math.max(Date.now(), next)), Math.max(0, next - Date.now()));
    return () => clearTimeout(id);
  }, [next]);

  return now;
};

export const isUnexpiredAt = (now: number) => (item: Pick<PendingIntervention, 'deadline'>) =>
  item.deadline === undefined || item.deadline > now;

/** The pending list with every card dropped the instant its producer stops waiting. */
export const useUnexpiredInterventions = (
  interventions: PendingIntervention[],
): PendingIntervention[] => {
  const now = useDeadlineClock(interventions.map((item) => item.deadline));
  return useMemo(() => interventions.filter(isUnexpiredAt(now)), [interventions, now]);
};

/**
 * Whether a tool row should read "timed out before it was answered" — live.
 *
 * Once `useUnexpiredInterventions` takes the card off screen at the deadline,
 * the inline row is the only place left to say what happened, and it has the
 * same problem the card list had: it only re-evaluates when something renders
 * it. A card whose answer is already in flight (`resolving`) was answered and
 * is never labelled as timed out.
 */
export const useIsTimedOutUnanswered = (
  intervention: ToolIntervention | undefined,
  state: unknown,
): boolean => {
  const deadline =
    intervention?.status === 'pending' && !intervention.resolving
      ? readHeterogeneousInterventionDeadline(state)
      : undefined;
  const now = useDeadlineClock([deadline]);
  return deadline !== undefined && now >= deadline;
};
