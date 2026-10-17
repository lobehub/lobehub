export interface PageCrudSliceState {
  /** Whether a page creation is in flight (drives the sidebar's pending row). */
  isCreatingNew: boolean;
}

export const initialPageCrudState: PageCrudSliceState = {
  isCreatingNew: false,
};
