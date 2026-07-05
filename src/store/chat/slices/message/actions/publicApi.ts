import { StateCreator } from 'zustand';
import { ChatMessage, ChatMessageMap } from '@/types/chat';
import { MessageStore, MessageSlice } from '../store';

export interface PublicMessageActions {
  /**
   * Add a message to the store.
   */
  addMessage: (message: ChatMessage) => void;
  /**
   * Update a message by ID.
   */
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  /**
   * Remove a message by ID.
   */
  removeMessage: (id: string) => void;
  /**
   * Get all messages as an array.
   */
  getMessages: () => ChatMessage[];
}

export const createPublicMessageActions: StateCreator<
  MessageStore,
  [],
  [],
  PublicMessageActions
> = (set, get) => ({
  addMessage: (message) => {
    set((state) => ({
      messages: { ...state.messages, [message.id]: message },
    }));
  },
  updateMessage: (id, updates) => {
    const current = get().messages[id];
    if (!current) return;
    const updated = { ...current, ...updates };
    set((state) => ({
      messages: { ...state.messages, [id]: updated },
    }));
  },
  removeMessage: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.messages;
      return { messages: rest };
    });
  },
  getMessages: () => Object.values(get().messages),
});
