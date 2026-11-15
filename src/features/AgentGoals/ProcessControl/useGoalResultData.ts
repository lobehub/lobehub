import { useEffect, useRef } from 'react';

import { useGoalCriteria } from '@/features/Acceptance/hooks';
import { useVerifyStore, verifySelectors } from '@/store/verify';

import type { GoalGraphView } from './goalGraphViewModel';
import {
  buildCriterionOutcomes,
  type CheckLike,
  type CriterionOutcome,
  findGoalAcceptanceView,
  latestRoundRunId,
} from './goalResultState';

/**
 * The graph's view of the acceptance, and a reason to re-read the bundle when
 * it moves. A rework keeps the same acceptance id, so reading by id alone held
 * the rejected round until a reload; the polled graph moving the acceptance (or
 * its Task node) on is what re-reads the bundle.
 *
 * The Goal's own status is part of that state too. A rework ends by putting the
 * Goal back on `achieved` — the moment the graph poll stops — and the snapshot
 * taken then can still carry the acceptance node's pre-rework status. Keyed on
 * the acceptance alone, the bundle stayed on the rejected round and the
 * sign-off strip kept reading 修改中 until the page was reloaded; the Goal
 * moving on is its own reason to re-read the latest round.
 */
export const goalResultGraphState = (graph: GoalGraphView) => {
  const acceptanceView = findGoalAcceptanceView(graph);
  return `${graph.goal.status}:${acceptanceView?.acceptance?.status}:${acceptanceView?.node.status}`;
};

/**
 * What the result page reads beyond the graph: the Goal-level acceptance
 * bundle (rounds, check results, evidence) and the criteria it was judged
 * against. The graph only knows the acceptance id and status; the verdict per
 * criterion lives in the verify records, which are the source of truth — the
 * page never restates them from anywhere else.
 */
export const useGoalResultData = (graph: GoalGraphView) => {
  const acceptanceView = findGoalAcceptanceView(graph);
  const acceptanceId = acceptanceView?.acceptance?.id;
  const criteriaIds = graph.goal.config?.acceptance?.criteriaIds ?? [];

  const graphState = goalResultGraphState(graph);
  // The same replica entry the Acceptance viewer reads: a reload paints the
  // last bundle from IndexedDB, and the page stays on it while the next state loads.
  const useFetchAcceptanceBundle = useVerifyStore((s) => s.useFetchAcceptanceBundle);
  const bundleData = useVerifyStore(verifySelectors.acceptanceBundle(acceptanceId));
  const bundleSync = useFetchAcceptanceBundle(acceptanceId);
  const criteria = useGoalCriteria(criteriaIds);

  // Re-read the bundle once the graph moves the acceptance on (see above). The
  // first state is covered by the sync's own mount request.
  const lastGraphState = useRef<string>(undefined);
  const { revalidate } = bundleSync;
  useEffect(() => {
    const previous = lastGraphState.current;
    lastGraphState.current = acceptanceId ? `${acceptanceId}|${graphState}` : undefined;
    if (!acceptanceId || previous === undefined || previous === lastGraphState.current) return;
    if (!previous.startsWith(`${acceptanceId}|`)) return;
    void revalidate();
  }, [acceptanceId, graphState, revalidate]);

  const bundle = { data: bundleData, error: bundleSync.error };

  const outcomes: CriterionOutcome[] = buildCriterionOutcomes({
    checks: (bundle.data?.checks ?? []) as unknown as CheckLike[],
    criteria: criteria.data ?? [],
    criteriaIds,
    latestRunId: latestRoundRunId(bundle.data?.rounds ?? []),
  });

  // A failed read must not pass for a result: empty checks would render every
  // criterion as unjudged and a missing bundle would hide the sign-off.
  // A failed background refresh keeps the result already on screen.
  const error =
    (bundle.data ? undefined : bundle.error) ?? (criteria.data ? undefined : criteria.error);

  return {
    acceptanceId,
    // The bundle is fresher than the graph snapshot right after a sign-off.
    acceptanceStatus: bundle.data?.acceptance.status ?? acceptanceView?.acceptance?.status,
    canReview: bundle.data?.canReview ?? false,
    error,
    isLoading:
      (!!acceptanceId && !bundle.data && bundle.error == null) ||
      (criteriaIds.length > 0 && criteria.isLoading),
    mutateAcceptance: bundleSync.revalidate,
    outcomes,
    retry: () => Promise.all([bundleSync.revalidate(), criteria.mutate()]),
  };
};

export type GoalResultData = ReturnType<typeof useGoalResultData>;
