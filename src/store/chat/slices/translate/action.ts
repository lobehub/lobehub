import { chainLangDetect, chainTranslate } from '@lobechat/prompts';
import { type ChatTranslate, type TracePayload } from '@lobechat/types';
import { TraceNameMap } from '@lobechat/types';
import { merge } from '@lobechat/utils';

import { supportLocales } from '@/locales/resources';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { dbMessageSelectors } from '@/store/chat/selectors';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

/**
 * chat translate
 */

type Setter = StoreSetter<ChatStore>;
export const chatTranslate = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ChatTranslateActionImpl(set, get, _api);

export class ChatTranslateActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  clearTranslate = async (id: string): Promise<void> => {
    await this.#get().updateMessageTranslate(id, false);
  };

  getCurrentTracePayload = (data: Partial<TracePayload>): TracePayload => {
    return {
      sessionId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      ...data,
    };
  };

  translateMessage = async (id: string, targetLang: string): Promise<void> => {
    const { updateMessageTranslate, internal_dispatchMessage } = this.#get();

    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
    if (!message) return;

    // Get current agent for translation
    const translationSetting = systemAgentSelectors.translation(useUserStore.getState());

    // create translate extra
    await updateMessageTranslate(id, { content: '', from: '', to: targetLang });

    // Create translate operation
    const { operationId } = this.#get().startOperation({
      context: {
        agentId: message.agentId,
        messageId: id,
        sessionId: message.sessionId,
        topicId: message.topicId,
      },
      label: 'Translating message',
      type: 'translate',
    });

    // Associate message with operation
    this.#get().associateMessageWithOperation(id, operationId);

    try {
      let content = '';
      let from = '';

      // detect from language
      chatService.fetchPresetTaskResult({
        onFinish: async (data) => {
          if (data && supportLocales.includes(data)) from = data;

          await updateMessageTranslate(id, { content, from, to: targetLang });
        },
        params: merge(translationSetting, chainLangDetect(message.content)),
        trace: this.#get().getCurrentTracePayload({ traceName: TraceNameMap.LanguageDetect }),
      });

      // translate to target language
      await chatService.fetchPresetTaskResult({
        onFinish: async (translatedContent) => {
          await updateMessageTranslate(id, { content: translatedContent, from, to: targetLang });
          this.#get().completeOperation(operationId);
        },
        onMessageHandle: (chunk) => {
          switch (chunk.type) {
            case 'text': {
              content += chunk.text;
              internal_dispatchMessage(
                {
                  id,
                  key: 'translate',
                  type: 'updateMessageExtra',
                  value: { content, from, to: targetLang },
                },
                { operationId },
              );
              break;
            }
          }
        },
        params: merge(translationSetting, chainTranslate(message.content, targetLang)),
        trace: this.#get().getCurrentTracePayload({ traceName: TraceNameMap.Translator }),
      });
    } catch (error) {
      this.#get().failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'TranslateError',
      });
      throw error;
    }
  };

  updateMessageTranslate = async (
    id: string,
    data: Partial<ChatTranslate> | false,
  ): Promise<void> => {
    // Optimistic update
    this.#get().internal_dispatchMessage({
      id,
      key: 'translate',
      type: 'updateMessageExtra',
      value: data === false ? undefined : data,
    });

    // Persist to database
    await messageService.updateMessageTranslate(id, data);
  };
}

export type ChatTranslateAction = Pick<ChatTranslateActionImpl, keyof ChatTranslateActionImpl>;
