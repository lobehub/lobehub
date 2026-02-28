import { type StateCreator } from 'zustand/vanilla';

import { type ResourceManagerMode } from '@/features/ResourceManager';

import { type State } from './initialState';
import { initialState } from './initialState';

export interface Action {
  /**
   * Set the current view item ID
   */
  setCurrentViewItemId: (id?: string) => void;
  /**
   * Set the view mode
   */
  setMode: (mode: ResourceManagerMode) => void;
  /**
   * Set selected file IDs
   */
  setSelectedFileIds: (ids: string[]) => void;
}

export type Store = Action & State;

type CreateStore = (
  initState?: Partial<State>,
) => StateCreator<Store, [['zustand/devtools', never]]>;

export const store: CreateStore = (publicState) => (set) => ({
  ...initialState,
  ...publicState,

  setCurrentViewItemId: (currentViewItemId) => {
    set({ currentViewItemId });
  },

  setMode: (mode) => {
    set({ mode });
  },

  setSelectedFileIds: (selectedFileIds) => {
    set({ selectedFileIds });
  },
});
