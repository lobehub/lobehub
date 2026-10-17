/** The acceptance list page. */
export const ACCEPTANCE_LIST_PATH = '/acceptance';

/** The two run-row columns that place a verify run inside an acceptance. */
export interface AcceptanceRoundRef {
  acceptanceId?: string | null;
  roundIndex?: number | null;
}

/**
 * The acceptance page deep-linked to the round a verify run belongs to:
 * `/acceptance/<acceptanceId>?r=<roundIndex>`. This is the only page a run's
 * report is reachable through, so `null` means the run has no page — it never
 * joined an acceptance, or its acceptance was deleted and left it standalone.
 *
 * Rounds count from 1, so a missing or out-of-range index opens the acceptance
 * on its default view instead of a round the page would reject.
 */
export const buildAcceptanceRoundPath = (
  ref: AcceptanceRoundRef | null | undefined,
): string | null => {
  if (!ref?.acceptanceId) return null;

  const path = `${ACCEPTANCE_LIST_PATH}/${encodeURIComponent(ref.acceptanceId)}`;
  const { roundIndex } = ref;

  return typeof roundIndex === 'number' && Number.isSafeInteger(roundIndex) && roundIndex > 0
    ? `${path}?r=${roundIndex}`
    : path;
};
