/** Share of the limit at which the softer "near the limit" warning appears. */
export const CHAR_LIMIT_WARN_RATIO = 0.9;

export interface CharLimitNotice {
  kind: 'blocked' | 'near';
  limit: number;
}

/**
 * Decides which page-size notice to show.
 *
 * - `blocked`: the last save was refused and the page is still over the refused
 *   limit, so the edits are not saved.
 * - `near`: the page reached 90% of the known limit (the last refusal's, else the
 *   plan's).
 */
export const resolveCharLimitNotice = ({
  length,
  planLimit,
  refusal,
}: {
  length: number;
  planLimit?: number;
  refusal?: { limit: number };
}): CharLimitNotice | undefined => {
  const limit = refusal?.limit ?? planLimit;
  if (!limit || length < limit * CHAR_LIMIT_WARN_RATIO) return undefined;
  return { kind: refusal && length > refusal.limit ? 'blocked' : 'near', limit };
};
