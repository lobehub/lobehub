/**
 * Nonvisual evidence assembly for the review predictor.
 *
 * Split out of the predictor because the allocation rule is the whole point and
 * it has to be testable without a database: which evidence reaches the reviewer
 * decides what the reviewer can possibly conclude.
 */

/** Evidence types whose payload is text the model can read inline. */
export const TEXT_EVIDENCE_TYPES = new Set(['text', 'markdown', 'dom_snapshot', 'transcript']);

/**
 * Characters of nonvisual evidence one review prompt may carry.
 *
 * Sized for the pinned review model's context with room for the system prompt,
 * the criterion body and up to three images.
 */
export const TEXT_EVIDENCE_BUDGET = 60_000;

export interface ReviewEvidenceRow {
  content: string;
  description?: string | null;
  id: string;
  type: string;
}

/**
 * Share the budget so a large attachment cannot starve a small one.
 *
 * Earlier this was first-fit over `createdAt`: the budget was spent in arrival
 * order and whatever was left got nothing. A 52k-character score dump therefore
 * pushed the 1.3k delivery summary out of the prompt entirely, and the reviewer
 * rejected the check for "missing evidence" that had in fact been attached.
 *
 * Water-filling instead: walk the rows smallest first, granting each an equal
 * share of what is still unspent. Rows that need less than their share release
 * the remainder to the larger ones, so every row is guaranteed at least
 * `budget / rowCount` characters and small rows are almost always whole.
 */
export const allocateEvidenceBudget = (
  rows: ReviewEvidenceRow[],
  budget = TEXT_EVIDENCE_BUDGET,
): Map<string, number> => {
  const allowances = new Map<string, number>();
  let remaining = Math.max(0, budget);
  [...rows]
    .sort((a, b) => a.content.length - b.content.length)
    .forEach((row, index) => {
      const share = Math.floor(remaining / (rows.length - index));
      const take = Math.min(row.content.length, share);
      allowances.set(row.id, take);
      remaining -= take;
    });
  return allowances;
};

/**
 * Render the evidence block, preserving capture order so the narrative a builder
 * assembled still reads in sequence.
 *
 * Every row is labelled with its type and its own description — the caption the
 * builder wrote is often the only place that says what the payload is ("rerun
 * log: all five commands exited 0"), and dropping it left the model guessing
 * from raw bytes. Truncation and omission are stated in the text rather than
 * applied silently, because a payload that just stops mid-line reads as a
 * corrupt artifact, which invites exactly the "insufficient evidence" rejection
 * the truncation caused.
 */
export const formatTextEvidence = (
  rows: ReviewEvidenceRow[],
  budget = TEXT_EVIDENCE_BUDGET,
): string => {
  if (rows.length === 0) return '';
  const allowances = allocateEvidenceBudget(rows, budget);
  return rows
    .map((row) => {
      const allowance = allowances.get(row.id) ?? 0;
      const caption = row.description?.trim();
      const header = `[Evidence ${row.id} · ${row.type}]${caption ? ` ${caption}` : ''}`;
      if (allowance <= 0)
        return `${header}\n(omitted: ${row.content.length} characters did not fit the evidence budget — ask for this one specifically if the check turns on it)`;
      if (allowance < row.content.length)
        return `${header}\n(truncated: first ${allowance} of ${row.content.length} characters)\n${row.content.slice(0, allowance)}`;
      return `${header}\n${row.content}`;
    })
    .join('\n\n');
};
