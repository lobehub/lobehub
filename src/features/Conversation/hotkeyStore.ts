import { create } from 'zustand';

interface ConversationHotkeyState {
  activateIfNone: (key: string) => void;
  activeConversationKey?: string;
  setActiveConversationKey: (key?: string) => void;
}

export const useConversationHotkeyStore = create<ConversationHotkeyState>((set) => ({
  activeConversationKey: undefined,
  activateIfNone: (key) =>
    set((state) => (state.activeConversationKey ? state : { activeConversationKey: key })),
  setActiveConversationKey: (activeConversationKey) => set({ activeConversationKey }),
}));
