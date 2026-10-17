/** Where the retired `/verify` report list now sends its visitors. */
export const ACCEPTANCE_LIST_PATH = '/acceptance';

/** The two run-row columns that place a verify run inside an acceptance. */
export interface AcceptanceRoundRef {
  acceptanceId?: string | null;
  roundIndex?: number | null;
}

/**
 * The acceptance page deep-linked to the round a verify run belongs to:
 * `/acceptance/<acceptanceId>?r=<roundIndex>`. This is the only page a run's
 * report is reachable through now that the standalone `/verify/:runId` page is
 * gone, so `null` means the run has no page — it never joined an acceptance, or
 * its acceptance was deleted and left it standalone.
 *
 * `search` is the incoming query string (an old `/verify` link's `?hl=`, for
 * one); its other params survive the move. Rounds count from 1, so a missing or
 * out-of-range index opens the acceptance on its default view instead of a
 * round the page would reject.
 */
export const buildAcceptanceRoundPath = (
  ref: AcceptanceRoundRef | null | undefined,
  search = '',
): string | null => {
  if (!ref?.acceptanceId) return null;

  const params = new URLSearchParams(search);
  const { roundIndex } = ref;
  if (typeof roundIndex === 'number' && Number.isSafeInteger(roundIndex) && roundIndex > 0) {
    params.set('r', String(roundIndex));
  } else {
    params.delete('r');
  }
  const query = params.toString();

  return `${ACCEPTANCE_LIST_PATH}/${encodeURIComponent(ref.acceptanceId)}${query ? `?${query}` : ''}`;
};
