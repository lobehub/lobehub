import { createWithEqualityFn } from 'zustand/traditional';

import { type OverlayUploadStatus, type PendingOverlayDispatch } from './overlayDispatch';

interface OverlayDispatchStore {
  clearPendingDispatch: (dispatchId?: string) => void;
  markDispatchUploadComplete: (
    dispatchId: string,
    status: Exclude<OverlayUploadStatus, 'uploading'>,
  ) => void;
  pendingDispatch: PendingOverlayDispatch | null;
  setPendingDispatch: (pendingDispatch: PendingOverlayDispatch) => void;
}

export const useOverlayDispatchStore = createWithEqualityFn<OverlayDispatchStore>()((set) => ({
  clearPendingDispatch: (dispatchId) =>
    set((state) => {
      if (dispatchId && state.pendingDispatch?.dispatchId !== dispatchId) return state;

      return { pendingDispatch: null };
    }),
  markDispatchUploadComplete: (dispatchId, status) =>
    set((state) => {
      if (state.pendingDispatch?.dispatchId !== dispatchId) return state;

      // On failure, drop screenshots so the prompt (if any) still delivers.
      const screenshotFileNames =
        status === 'failed' ? [] : state.pendingDispatch.screenshotFileNames;

      return {
        pendingDispatch: {
          ...state.pendingDispatch,
          screenshotFileNames,
          uploadStatus: status,
        },
      };
    }),
  pendingDispatch: null,
  setPendingDispatch: (pendingDispatch) => set({ pendingDispatch }),
}));

export const getOverlayDispatchStoreState = () => useOverlayDispatchStore.getState();
