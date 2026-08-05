import { create } from 'zustand';

import type { AicoBillingContext } from './types';

interface AicoBillingStoreState {
  /** Explicit context attached to managed chat requests. */
  context: AicoBillingContext | null;
  hydrated: boolean;
  setContext: (context: AicoBillingContext) => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useAicoBillingStore = create<AicoBillingStoreState>((set) => ({
  context: null,
  hydrated: false,
  setContext: (context) => set({ context, hydrated: true }),
  setHydrated: (hydrated) => set({ hydrated }),
}));

/** Sync read for chat service (outside React). */
export const getAicoBillingContext = (): AicoBillingContext | null =>
  useAicoBillingStore.getState().context;

export const setAicoBillingContext = (context: AicoBillingContext) => {
  useAicoBillingStore.getState().setContext(context);
};
