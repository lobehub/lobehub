import { ChatTTS } from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import { messageService } from '@/services/message';
import { ChatStore } from '@/store/chat/store';

/**
 * enhance chat action like translate,tts
 */
export interface ChatTTSAction {
  clearTTS: (id: string) => Promise<void>;
  ttsMessage: (
    id: string,
    state?: { contentMd5?: string; file?: string; voice?: string },
  ) => Promise<void>;
  updateMessageTTS: (id: string, data: Partial<ChatTTS> | false) => Promise<void>;
}

export const chatTTS: StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatTTSAction> = (
  set,
  get,
) => ({
  clearTTS: async (id) => {
    await get().updateMessageTTS(id, false);
  },

  ttsMessage: async (id, state = {}) => {
    await get().updateMessageTTS(id, state);
  },

  updateMessageTTS: async (id, data) => {
    await messageService.updateMessageTTS(id, data);
    await get().refreshMessages();
  },
});
