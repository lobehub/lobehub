import type {
  AgentSignalProcedureRecord,
  DomainProcedureAccumulatorState,
  DomainProcedureBatchScore,
} from './types';

/**
 * Input for deterministic domain procedure batch scoring.
 */
export interface ScoreDomainProcedureBatchInput {
  /** Accumulator bucket being scored. */
  bucket: DomainProcedureAccumulatorState;
  /** Current millisecond timestamp. */
  now: number;
  /** Records contained in the accumulator bucket. */
  records: AgentSignalProcedureRecord[];
}

/**
 * Scores accumulated procedure records with deterministic P0 rules.
 *
 * Use when:
 * - Weak signals need a compact domain-level score
 * - Direct tool context records should remain zero-pressure
 *
 * Expects:
 * - Candidate records may carry `cheapScoreDelta`
 * - Context records do not create positive handling pressure
 *
 * Returns:
 * - Batch score with per-record reasons and aggregate suggestions
 */
export const scoreDomainProcedureBatch = (
  input: ScoreDomainProcedureBatchInput,
): DomainProcedureBatchScore => {
  // Scoring is additive per incoming signal record:
  // - context records add 0, so direct tool outcomes are remembered without triggering actions;
  // - observed records add `cheapScoreDelta`, so repeated weak feedback can cross the threshold;
  // - suggested actions are derived from the aggregate score.
  //
  // Current tunable values are the per-record `cheapScoreDelta`, the aggregate action threshold,
  // the per-record role weights, confidence, and the suggested action mapping.
  const itemScores = input.records.map((record) => {
    const score = record.accumulatorRole === 'candidate' ? (record.cheapScoreDelta ?? 0) : 0;

    return {
      reasons: score > 0 ? ['observed-record'] : ['context-record'],
      recordId: record.id,
      score,
      suggestedAction: score > 0 ? ('maintain' as const) : undefined,
    };
  });
  const aggregateScore = itemScores.reduce((sum, item) => sum + item.score, 0);

  return {
    aggregateScore,
    confidence: input.records.length > 0 ? 0.7 : 0,
    itemScores,
    scoredAt: input.now,
    suggestedActions: aggregateScore >= 1 ? ['maintain'] : [],
  };
};
