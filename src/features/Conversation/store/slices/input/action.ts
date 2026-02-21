import { type StateCreator } from 'zustand';

import { useChatStore } from '@/store/chat';

import { type State } from '../../initialState';

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
    // Also clear ChatStore's mainInputEditor
    useChatStore.setState({ mainInputEditor: null });
  },

  setEditor: (editor) => {
    set({ editor });
    // Sync to ChatStore's mainInputEditor for error recovery in sendMessage
    useChatStore.setState({ mainInputEditor: editor });
  },

  updateInputMessage: (message) => {
    set({ inputMessage: message });
  },
});
