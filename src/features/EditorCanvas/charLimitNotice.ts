/** Share of the limit at which the softer "near the limit" warning appears. */
export const CHAR_LIMIT_WARN_RATIO = 0.9;

export interface CharLimitNotice {
  /**
   * How far the page is past the limit, from mildest to most severe:
   * `near` (info), `over` (warning), `blocked` (error).
   */
  kind: 'blocked' | 'near' | 'over';
  limit: number;
}

/**
 * Decides which page-size notice to show.
 *
 * - `near`: the page reached 90% of the known limit (the last refusal's, else the
 *   plan's) and is still within it.
 * - `over`: the page is past the plan's limit but no save has been refused yet,
 *   so the next save will be.
 * - `blocked`: the last save was refused and the page is still over the refused
 *   limit, so the edits are not saved.
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
  if (length <= limit) return { kind: 'near', limit };
  return { kind: refusal ? 'blocked' : 'over', limit };
};
