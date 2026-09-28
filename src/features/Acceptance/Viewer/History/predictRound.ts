/**
 * Pure state readers for the "ask AI to review" round-trip.
 *
 * The server dispatches the prediction batch after responding, so the client
 * polls the bundle until every queued check has an answer. The subtlety both
 * helpers encode: a prediction that AGREES with the verifier (or skips, or
 * errors) renders no proposal card — `prediction` stays null in the bundle and
 * only `predictionStatus` records that the attempt finished. Reading the card
 * alone makes a clean bill of health indistinguishable from a batch that never
 * ran, which is exactly the bug that shipped: the button span the full timeout
 * and then said nothing.
 */

interface PredictRoundCheck {
  /** The surfaced proposal card — rejects awaiting the reviewer only. */
  prediction?: unknown | null;
  /** Recorded outcome of the attempt: `judged` / `skipped` / `errored`. */
  predictionStatus?: string | null;
  result?: { userDecision?: string | null } | null;
}

/** The checks this batch still owes an answer — the poll's exit condition. */
export const countAwaitingPrediction = (checks: PredictRoundCheck[]): number =>
  checks.filter((check) => check.result && !check.result.userDecision && !check.predictionStatus)
    .length;

export interface PredictRoundSummary {
  /** Attempts that produced a verdict (accepts included). */
  judged: number;
  outcome: 'allClear' | 'inconclusive' | 'proposals';
  /** Cards the reviewer now has to look at. */
  proposals: number;
}

/**
 * What the finished round should tell the reviewer. Zero cards is a meaningful
 * result, not silence — "reviewed and agreed" and "could not review" both need
 * saying, or the button reads as broken every time the delivery is clean.
 */
export const summarizePredictRound = (checks: PredictRoundCheck[]): PredictRoundSummary => {
  const pending = checks.filter((check) => check.result && !check.result.userDecision);
  const proposals = pending.filter((check) => check.prediction).length;
  const judged = pending.filter((check) => check.predictionStatus === 'judged').length;

  return {
    judged,
    outcome: proposals > 0 ? 'proposals' : judged > 0 ? 'allClear' : 'inconclusive',
    proposals,
  };
};
