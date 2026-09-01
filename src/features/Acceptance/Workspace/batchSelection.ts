import type { AcceptanceStatus } from '@lobechat/types';

import type { AcceptanceListItem } from '@/services/verify';

import { type AcceptanceStatusAction, getAcceptanceStatusActions } from '../Viewer/statusActions';

export type AcceptanceSelectAllState = 'all' | 'none' | 'partial';

export const toggleAcceptanceSelection = (selected: string[], id: string): string[] =>
  selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id];

/**
 * The selection as the user can currently SEE it.
 *
 * Selection is remembered raw, but every read narrows it to the rows the active
 * filter/search is showing: a sweep must never touch a row that scrolled out of
 * the list behind a filter change, and the "3 selected" count must match the
 * three ticked boxes on screen. Clearing the filter brings the earlier picks
 * back, which is what a user who filtered mid-selection expects.
 */
export const visibleAcceptanceSelection = (
  selected: string[],
  visibleItems: AcceptanceListItem[],
): string[] => {
  const visible = new Set(visibleItems.map((item) => item.id));
  return selected.filter((id) => visible.has(id));
};

export const acceptanceSelectAllState = (
  visibleCount: number,
  selectedCount: number,
): AcceptanceSelectAllState => {
  if (visibleCount === 0 || selectedCount === 0) return 'none';
  return selectedCount >= visibleCount ? 'all' : 'partial';
};

/** Select-all toggles to "everything visible" unless everything already is. */
export const nextAcceptanceSelectAll = (
  selected: string[],
  visibleItems: AcceptanceListItem[],
): string[] => {
  const visibleIds = visibleItems.map((item) => item.id);
  const state = acceptanceSelectAllState(
    visibleIds.length,
    visibleAcceptanceSelection(selected, visibleItems).length,
  );
  if (state === 'all') return selected.filter((id) => !visibleIds.includes(id));

  const merged = new Set(selected);
  for (const id of visibleIds) merged.add(id);
  return [...merged];
};

/**
 * The subset of a selection a status action can actually move.
 *
 * A sweep mixes states — an already-accepted delivery cannot be accepted again,
 * and a still-verifying one is not decidable at all. Filtering here (rather than
 * letting the server reject row by row) is what lets the bar disable an action
 * that would do nothing and report an honest count for one that does.
 */
export const acceptanceBatchTargets = (
  items: AcceptanceListItem[],
  selected: string[],
  action: AcceptanceStatusAction,
): string[] => {
  const selectedSet = new Set(selected);
  return items
    .filter(
      (item) =>
        selectedSet.has(item.id) &&
        getAcceptanceStatusActions(item.status as AcceptanceStatus).includes(action),
    )
    .map((item) => item.id);
};

/**
 * The server caps one sweep at 200 ids, so a select-all after enough scrolling
 * would be rejected wholesale — accept, close and delete all failing before
 * anything changed. Split the work instead: a sweep is a background chore, and
 * a partial result the caller can report beats a hard refusal.
 */
export const ACCEPTANCE_BATCH_CHUNK = 200;

export const chunkAcceptanceBatch = (ids: string[], size = ACCEPTANCE_BATCH_CHUNK): string[][] => {
  if (ids.length === 0) return [];
  if (ids.length <= size) return [ids];

  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
};
