import { createWithEqualityFn } from 'zustand/traditional';

import { type PendingForwardDispatch } from './forwardDispatch';

interface ForwardDispatchStore {
  clearPendingForward: (dispatchId?: string) => void;
  pendingForward: PendingForwardDispatch | null;
  setPendingForward: (pendingForward: PendingForwardDispatch) => void;
}

export const useForwardDispatchStore = createWithEqualityFn<ForwardDispatchStore>()((set) => ({
  clearPendingForward: (dispatchId) =>
    set((state) => {
      if (dispatchId && state.pendingForward?.dispatchId !== dispatchId) return state;

      return { pendingForward: null };
    }),
  pendingForward: null,
  setPendingForward: (pendingForward) => set({ pendingForward }),
}));

export const getForwardDispatchStoreState = () => useForwardDispatchStore.getState();
