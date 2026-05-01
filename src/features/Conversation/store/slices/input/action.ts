import { type StateCreator } from 'zustand';

import { useChatStore } from '@/store/chat';

import { type State } from '../../initialState';

export interface InputAction {
  /**
   * Cleanup input state
   */
  cleanupInput: () => void;

  /**
   * Report the floating overlay height (TodoProgress + QueueTray) so the
   * ChatList scroll container can reserve matching bottom padding.
   */
  setChatInputOverlayHeight: (height: number) => void;

  /**
   * Set the editor instance
   */
  setEditor: (editor: any) => void;

  /**
   * Update the input message
   */
  updateInputMessage: (message: string) => void;
}

export const inputSlice: StateCreator<State & InputAction, [], [], InputAction> = (set, get) => ({
  cleanupInput: () => {
    set({ chatInputOverlayHeight: 0, editor: null, inputMessage: '' });
    // Also clear ChatStore's mainInputEditor
    useChatStore.setState({ mainInputEditor: null });
  },

  setChatInputOverlayHeight: (height) => {
    if (get().chatInputOverlayHeight === height) return;
    set({ chatInputOverlayHeight: height });
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
