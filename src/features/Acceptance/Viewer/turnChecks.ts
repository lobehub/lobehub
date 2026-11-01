import type { AcceptanceBundle } from '@/services/verify';

/** A round link displays that round's evidence, never the latest replacement. */
export const checksForTurn = (
  data: AcceptanceBundle,
  turn: number | null,
): AcceptanceBundle['checks'] => {
  if (turn === null) return data.checks;
  const plan = data.rounds.find((round) => round.run.roundIndex === turn)?.run.plan ?? [];
  return data.checks.flatMap((check) => {
    const planItem = plan.find(
      (item) =>
        item.id === check.id ||
        check.supersededIds?.includes(item.id) ||
        (!item.sourceFlowNode && item.sourceCriterionId === check.id),
    );
    const step = check.timeline.find((entry) => entry.roundIndex === turn);
    if (!step)
      return planItem
        ? [
            {
              ...check,
              id: planItem.id,
              title: planItem.title,
              required: planItem.required,
              planItem,
              state: 'not_executed' as const,
              result: undefined,
              resultRound: undefined,
              evidence: [],
              prediction: null,
              reviews: [],
              userReview: undefined,
              carriedFromRound: undefined,
              fixed: false,
            },
          ]
        : [];
    if (check.resultRound === turn) return [check];
    const review = check.reviews.findLast((item) => item.roundIndex === turn);
    return [
      {
        ...check,
        evidence: step.evidence,
        planItem,
        prediction: null,
        result: undefined,
        resultRound: turn,
        state: step.state,
        title: step.title,
        reviews: check.reviews.filter((review) => review.roundIndex <= turn),
        userReview: review ? { ...review, stale: false } : undefined,
      },
    ];
  });
};
