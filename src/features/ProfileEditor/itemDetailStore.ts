import { create } from 'zustand';

import { type ItemDetail } from './ItemDetailPanel';

interface ItemDetailState {
  close: () => void;
  detail?: ItemDetail;
  open: (detail: ItemDetail) => void;
}

/**
 * The item whose details sit in the page's right-hand panel. A list opens one by clicking a row;
 * the page shell renders the panel, so it docks to the page edge like any other side panel.
 */
export const useItemDetailStore = create<ItemDetailState>((set) => ({
  close: () => set({ detail: undefined }),
  detail: undefined,
  open: (detail) => set({ detail }),
}));
