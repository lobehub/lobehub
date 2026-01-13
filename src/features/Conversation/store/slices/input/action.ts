import type { StateCreator } from 'zustand';

import type { State } from '../../initialState';

export interface InputAction {
  /**
   * Cleanup input state
   */
  cleanupInput: () => void;

  /**
   * Set the editor instance
   */
  setEditor: (editor: any) => void;

  /**
   * Update the input message
   */
  updateInputMessage: (message: string) => void;
}

export const inputSlice: StateCreator<State & InputAction, [], [], InputAction> = (set) => ({
  cleanupInput: () => {
    set({ editor: null, inputMessage: '' });
  },

  setEditor: (editor) => {
    set({ editor });
  },

  updateInputMessage: (message) => {
    set({ inputMessage: message });
  },
});
