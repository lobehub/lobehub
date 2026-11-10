import type { VerifyCheckDispute, VerifyDisputeArbitration } from '@lobechat/types';

/**
 * The builder's dispute on a check result, or undefined when there is none.
 * Metadata is an open JSON bag, so a malformed entry reads as "no dispute"
 * rather than crashing the row.
 */
export const readCheckDispute = (metadata: unknown): VerifyCheckDispute | undefined => {
  const dispute = (metadata as { dispute?: unknown } | null | undefined)?.dispute as
    Partial<VerifyCheckDispute> | undefined;
  if (!dispute || typeof dispute !== 'object') return undefined;
  if (dispute.kind !== 'invalid_criterion' && dispute.kind !== 'missed_evidence') return undefined;
  if (typeof dispute.reason !== 'string') return undefined;
  return dispute as VerifyCheckDispute;
};

export interface DisputeVoteTally {
  /** Members that could not rule — they cast no vote. */
  errored: number;
  /** Members that ruled either way. */
  judged: number;
  upheld: number;
}

/** Counts the panel's votes: "2/3 upheld" reads `upheld`/`judged`. */
export const tallyDisputeVotes = (arbitration: VerifyDisputeArbitration): DisputeVoteTally => {
  let errored = 0;
  let judged = 0;
  let upheld = 0;
  for (const vote of arbitration.votes ?? []) {
    if (vote.status !== 'judged') {
      errored += 1;
      continue;
    }
    judged += 1;
    if (vote.upheld) upheld += 1;
  }
  return { errored, judged, upheld };
};
