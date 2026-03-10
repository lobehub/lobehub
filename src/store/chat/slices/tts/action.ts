import { type ChatTTS } from '@lobechat/types';

import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

/**
 * enhance chat action like translate,tts
 */

type Setter = StoreSetter<ChatStore>;
export const chatTTS = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ChatTTSActionImpl(set, get, _api);

export class ChatTTSActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  clearTTS = async (id: string): Promise<void> => {
    await this.#get().updateMessageTTS(id, false);
  };

  ttsMessage = async (
    id: string,
    state: { contentMd5?: string; file?: string; voice?: string } = {},
  ): Promise<void> => {
    await this.#get().updateMessageTTS(id, state);
  };

  updateMessageTTS = async (id: string, data: Partial<ChatTTS> | false): Promise<void> => {
    // Optimistic update
    this.#get().internal_dispatchMessage({
      id,
      key: 'tts',
      type: 'updateMessageExtra',
      value: data === false ? undefined : data,
    });

    // Persist to database
    await messageService.updateMessageTTS(id, data);
  };
}

export type ChatTTSAction = Pick<ChatTTSActionImpl, keyof ChatTTSActionImpl>;
