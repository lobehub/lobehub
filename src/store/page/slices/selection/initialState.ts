export interface SelectionState {
  allPagesDrawerOpen: boolean;
  renamingPageId: string | null;
  selectedPageId: string | null;
}

export const initialSelectionState: SelectionState = {
  allPagesDrawerOpen: false,
  renamingPageId: null,
  selectedPageId: null,
};
