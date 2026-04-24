import { createWithEqualityFn } from 'zustand/traditional';

import { type PendingOverlayDispatch } from './overlayDispatch';

interface OverlayDispatchStore {
  clearPendingDispatch: (dispatchId?: string) => void;
  pendingDispatch: PendingOverlayDispatch | null;
  setPendingDispatch: (pendingDispatch: PendingOverlayDispatch) => void;
}

export const useOverlayDispatchStore = createWithEqualityFn<OverlayDispatchStore>()((set) => ({
  clearPendingDispatch: (dispatchId) =>
    set((state) => {
      if (dispatchId && state.pendingDispatch?.dispatchId !== dispatchId) return state;

      return { pendingDispatch: null };
    }),
  pendingDispatch: null,
  setPendingDispatch: (pendingDispatch) => set({ pendingDispatch }),
}));

export const getOverlayDispatchStoreState = () => useOverlayDispatchStore.getState();
