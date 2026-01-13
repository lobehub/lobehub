import { create } from 'zustand';

import { useGlobalStore } from '@/store/global';

interface FeedbackModalStore {
  close: () => void;
  isOpen: boolean;
  open: () => void;
}

export const useFeedbackModal = create<FeedbackModalStore>((set) => ({
  close: () => set({ isOpen: false }),
  isOpen: false,
  open: () => {
    // Close command menu when opening feedback modal
    useGlobalStore.getState().updateSystemStatus({ showCommandMenu: false });
    set({ isOpen: true });
  },
}));
