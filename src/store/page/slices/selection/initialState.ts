export interface SelectionState {
  renamingPageId: string | null;
  selectedPageId: string | null;
}

export const initialSelectionState: SelectionState = {
  renamingPageId: null,
  selectedPageId: null,
};
