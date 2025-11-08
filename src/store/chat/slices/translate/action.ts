import { chainLangDetect, chainTranslate } from '@lobechat/prompts';
import { ChatTranslate, TraceNameMap, TracePayload } from '@lobechat/types';
import { produce } from 'immer';
import { StateCreator } from 'zustand/vanilla';

import { supportLocales } from '@/locales/resources';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { chatSelectors } from '@/store/chat/selectors';
import { ChatStore } from '@/store/chat/store';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('enhance');

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
    sessionId: get().activeId,
    topicId: get().activeTopicId,
    ...data,
  }),

  translateMessage: async (id, targetLang) => {
    const { internal_toggleChatLoading, updateMessageTranslate, internal_dispatchMessage } = get();

    const message = chatSelectors.getMessageById(id)(get());
    if (!message) return;

    // Get current agent for translation
    const translationSetting = systemAgentSelectors.translation(useUserStore.getState());

    // create translate extra
    await updateMessageTranslate(id, { content: '', from: '', to: targetLang });

    internal_toggleChatLoading(true, id, n('translateMessage(start)', { id }));

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
      onFinish: async (content) => {
        await updateMessageTranslate(id, { content, from, to: targetLang });
        internal_toggleChatLoading(false, id);
      },
      onMessageHandle: (chunk) => {
        switch (chunk.type) {
          case 'text': {
            internal_dispatchMessage({
              id,
              key: 'translate',
              type: 'updateMessageExtra',
              value: produce({ content: '', from, to: targetLang }, (draft) => {
                content += chunk.text;
                draft.content += content;
              }),
            });
            break;
          }
        }
      },
      params: merge(translationSetting, chainTranslate(message.content, targetLang)),
      trace: get().getCurrentTracePayload({ traceName: TraceNameMap.Translator }),
    });
  },

  updateMessageTranslate: async (id, data) => {
    await messageService.updateMessageTranslate(id, data);

    await get().refreshMessages();
  },
});
