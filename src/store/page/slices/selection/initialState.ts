export interface PageSelectionSliceState {
  /** Whether the all-pages drawer is open. */
  allPagesDrawerOpen: boolean;
  /** Id of the page being renamed in place (null if none). */
  renamingPageId: string | null;
  /** Currently selected page id. */
  selectedPageId: string | null;
}

export const initialPageSelectionState: PageSelectionSliceState = {
  allPagesDrawerOpen: false,
  renamingPageId: null,
  selectedPageId: null,
};
