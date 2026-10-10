import { type NavigateFunction } from 'react-router';

import { initialPageCrudState, type PageCrudSliceState } from './slices/crud/initialState';
import { initialPageListState, type PageListSliceState } from './slices/list/initialState';
import {
  initialPageSelectionState,
  type PageSelectionSliceState,
} from './slices/selection/initialState';

/**
 * UI-only page state that no replica owns: the search box, the "not in a
 * library" filter and the router navigate function the actions call.
 */
export interface PageUiState {
  navigate?: NavigateFunction;
  /** Search keywords for filtering pages in the sidebar. */
  searchKeywords: string;
  /** Filter to show only pages not in any library. */
  showOnlyPagesNotInLibrary: boolean;
}

/**
 * Page domain state. The list / detail rows and the selection live in their
 * slices' state so each slice owns (and the replica engine writes) its own
 * fields; this composes them into the store's single state shape.
 */
export type PageState = PageCrudSliceState &
  PageListSliceState &
  PageSelectionSliceState &
  PageUiState;

export const initialState: PageState = {
  ...initialPageListState,
  ...initialPageCrudState,
  ...initialPageSelectionState,
  searchKeywords: '',
  showOnlyPagesNotInLibrary: false,
};
