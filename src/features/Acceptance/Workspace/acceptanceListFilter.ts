export type AcceptanceListFilter = 'active' | 'all' | 'completed';

export const DEFAULT_ACCEPTANCE_LIST_FILTER: AcceptanceListFilter = 'active';

export const normalizeAcceptanceListFilter = (value: unknown): AcceptanceListFilter =>
  value === 'all' || value === 'completed' ? value : DEFAULT_ACCEPTANCE_LIST_FILTER;

/**
 * Which empty state a zero-result list should render.
 *
 * `filtered` — "no match for this query/filter" plus a show-all escape hatch.
 * `firstRun` — the plain "no acceptances yet" state.
 *
 * A user who owns NOTHING must always read `firstRun`: the default filter is
 * `active`, so their very first visit (e.g. following a shared link) would
 * otherwise show "no active acceptances · show all" — an escape hatch whose
 * click reveals the same nothing. `allListEmpty` stays undefined while the
 * unfiltered probe has not resolved; treat that as "not confirmed empty" so
 * the state never flickers from filtered to firstRun and back.
 */
export const acceptanceListEmptyVariant = ({
  allListEmpty,
  filter,
  searching,
}: {
  allListEmpty?: boolean;
  filter: AcceptanceListFilter;
  searching: boolean;
}): 'filtered' | 'firstRun' =>
  (searching || filter !== 'all') && !allListEmpty ? 'filtered' : 'firstRun';
