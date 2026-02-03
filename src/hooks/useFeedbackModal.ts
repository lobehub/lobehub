import { create } from 'zustand';

import { useGlobalStore } from '@/store/global';

interface FeedbackInitialValues {
  message?: string;
  title?: string;
}

interface FeedbackModalStore {
  close: () => void;
  initialValues?: FeedbackInitialValues;
  isOpen: boolean;
  open: (initialValues?: FeedbackInitialValues) => void;
}

export const useFeedbackModal = create<FeedbackModalStore>((set) => ({
  close: () => set({ initialValues: undefined, isOpen: false }),
  initialValues: undefined,
  isOpen: false,
  open: (initialValues) => {
    // Close command menu when opening feedback modal
    useGlobalStore.getState().updateSystemStatus({ showCommandMenu: false });
    set({ initialValues, isOpen: true });
  },
}));
