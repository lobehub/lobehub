import { chainLangDetect, chainTranslate } from '@lobechat/prompts';
import { type ChatTranslate, TraceNameMap, type TracePayload } from '@lobechat/types';
import { merge } from '@lobechat/utils';
import { type StateCreator } from 'zustand/vanilla';

import { supportLocales } from '@/locales/resources';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { dbMessageSelectors } from '@/store/chat/selectors';
import { type ChatStore } from '@/store/chat/store';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

/**
 * chat translate
 */
export interface ChatTranslateAction {
  clearTranslate: (id: string) => Promise<void>;
  getCurrentTracePayload: (data: Partial<TracePayload>) => TracePayload;
  translateMessage: (id: string, targetLang: string) => Promise<void>;
  updateMessageTranslate: (id: string, data: Partial<ChatTranslate> | false) => Promise<void>;
}

export const chatTranslate: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatTranslateAction
> = (set, get) => ({
  clearTranslate: async (id) => {
    await get().updateMessageTranslate(id, false);
  },
  getCurrentTracePayload: (data) => ({
    sessionId: get().activeAgentId,
    topicId: get().activeTopicId,
    ...data,
  }),

  translateMessage: async (id, targetLang) => {
    const { updateMessageTranslate, internal_dispatchMessage } = get();

    const message = dbMessageSelectors.getDbMessageById(id)(get());
    if (!message) return;

    // Get current agent for translation
    const translationSetting = systemAgentSelectors.translation(useUserStore.getState());

    // create translate extra
    await updateMessageTranslate(id, { content: '', from: '', to: targetLang });

    // Create translate operation
    const { operationId } = get().startOperation({
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
    get().associateMessageWithOperation(id, operationId);

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
        trace: get().getCurrentTracePayload({ traceName: TraceNameMap.LanguageDetect }),
      });

      // translate to target language
      await chatService.fetchPresetTaskResult({
        onFinish: async (translatedContent) => {
          await updateMessageTranslate(id, { content: translatedContent, from, to: targetLang });
          get().completeOperation(operationId);
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
        trace: get().getCurrentTracePayload({ traceName: TraceNameMap.Translator }),
      });
    } catch (error) {
      get().failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'TranslateError',
      });
      throw error;
    }
  },

  updateMessageTranslate: async (id, data) => {
    // Optimistic update
    get().internal_dispatchMessage({
      id,
      key: 'translate',
      type: 'updateMessageExtra',
      value: data === false ? undefined : data,
    });

    // Persist to database
    await messageService.updateMessageTranslate(id, data);
  },
});
