import { useClientDataSWR } from '@/libs/swr';
import { verifyService } from '@/services/verify';

import type { GoalGraphView } from './goalGraphViewModel';
import {
  buildCriterionOutcomes,
  type CheckLike,
  type CriterionOutcome,
  findGoalAcceptanceView,
  latestRoundRunId,
} from './goalResultState';

/**
 * Keyed by the graph's view of the acceptance as well as its id. A rework keeps
 * the same acceptance id, so an id-only key held the rejected round until a
 * reload; the polled graph moving the acceptance (or its Task node) on is what
 * re-reads the bundle.
 */
export const goalResultAcceptanceKey = (acceptanceId: string, graphState: string) =>
  ['goal-result-acceptance', acceptanceId, graphState] as const;

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

  const graphState = `${acceptanceView?.acceptance?.status}:${acceptanceView?.node.status}`;
  const bundle = useClientDataSWR(
    acceptanceId ? goalResultAcceptanceKey(acceptanceId, graphState) : null,
    () => verifyService.getAcceptanceBundle(acceptanceId!),
    // Keep the page on the last bundle while the next state loads, instead of
    // dropping back to skeletons every time the graph moves.
    { keepPreviousData: true },
  );
  const criteria = useClientDataSWR(
    criteriaIds.length > 0
      ? ['goal-acceptance-criteria', graph.goal.id, criteriaIds.join(',')]
      : null,
    () => verifyService.getCriteria(criteriaIds),
  );

  const outcomes: CriterionOutcome[] = buildCriterionOutcomes({
    checks: (bundle.data?.checks ?? []) as unknown as CheckLike[],
    criteria: criteria.data ?? [],
    criteriaIds,
    latestRunId: latestRoundRunId(bundle.data?.rounds ?? []),
  });

  // A failed read must not pass for a result: empty checks would render every
  // criterion as unjudged and a missing bundle would hide the sign-off.
  const error = bundle.error ?? criteria.error;

  return {
    acceptanceId,
    // The bundle is fresher than the graph snapshot right after a sign-off.
    acceptanceStatus: bundle.data?.acceptance.status ?? acceptanceView?.acceptance?.status,
    canReview: bundle.data?.canReview ?? false,
    error,
    isLoading:
      (!!acceptanceId && bundle.isLoading && !bundle.data) ||
      (criteriaIds.length > 0 && criteria.isLoading),
    mutateAcceptance: bundle.mutate,
    outcomes,
    retry: () => Promise.all([bundle.mutate(), criteria.mutate()]),
  };
};

export type GoalResultData = ReturnType<typeof useGoalResultData>;
