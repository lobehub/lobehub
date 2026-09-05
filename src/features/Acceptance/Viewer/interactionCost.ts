import type { VerifyInteractionCost } from '@lobechat/types';

import { readInteractionCost } from '../Report/interactionCostModel';

/** A round's cost plus the round it was measured in. */
export interface PricedRound {
  cost: VerifyInteractionCost;
  roundIndex: number;
}

interface RoundLike {
  run: { metadata?: unknown; roundIndex?: number | null };
}

interface CheckLike {
  id: string;
  title: string;
}

/**
 * The newest round that actually recorded an interaction cost.
 *
 * Not simply the last round: a follow-up CLI round carries no trace, and
 * blanking the measurement a UI round already made would read as "this flow
 * became free" rather than "this round measured nothing".
 */
export const selectPricedRound = (rounds: readonly RoundLike[]): PricedRound | null => {
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    const cost = readInteractionCost(round.run.metadata);
    if (cost) return { cost, roundIndex: round.run.roundIndex ?? 0 };
  }

  return null;
};

/**
 * `checkItemId` → check title, so a phase the driver attributed to a check reads
 * as the thing being judged instead of an internal slug.
 */
export const buildCheckLabels = (checks: readonly CheckLike[]): Record<string, string> =>
  Object.fromEntries(checks.map((check) => [check.id, check.title]));
