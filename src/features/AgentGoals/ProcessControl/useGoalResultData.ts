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

export const goalResultAcceptanceKey = (acceptanceId: string) =>
  ['goal-result-acceptance', acceptanceId] as const;

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

  const bundle = useClientDataSWR(acceptanceId ? goalResultAcceptanceKey(acceptanceId) : null, () =>
    verifyService.getAcceptanceBundle(acceptanceId!),
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

  return {
    acceptanceId,
    // The bundle is fresher than the graph snapshot right after a sign-off.
    acceptanceStatus: bundle.data?.acceptance.status ?? acceptanceView?.acceptance?.status,
    canReview: bundle.data?.canReview ?? false,
    isLoading:
      (!!acceptanceId && bundle.isLoading) || (criteriaIds.length > 0 && criteria.isLoading),
    mutateAcceptance: bundle.mutate,
    outcomes,
  };
};

export type GoalResultData = ReturnType<typeof useGoalResultData>;
