import { SendMessageParams } from '@lobechat/types';
import { useMemo, useState } from 'react';

import { useGeminiChineseWarning } from '@/hooks/useGeminiChineseWarning';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/slices/chat';
import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

export type UseSendMessageParams = Pick<
  SendMessageParams,
  'onlyAddUserMessage' | 'isWelcomeQuestion'
>;

export const useSendThreadMessage = () => {
  const [loading, setLoading] = useState(false);
  const canNotSend = useChatStore(threadSelectors.isSendButtonDisabledByMessage);
  const generating = useChatStore((s) => threadSelectors.isThreadAIGenerating(s));
  const stop = useChatStore((s) => s.stopGenerateMessage);
  const [sendMessage, updateInputMessage] = useChatStore((s) => [
    s.sendThreadMessage,
    s.updateThreadInputMessage,
  ]);
  const checkGeminiChineseWarning = useGeminiChineseWarning();

  const handleSend = async (params: UseSendMessageParams = {}) => {
    const store = useChatStore.getState();

    if (threadSelectors.isThreadAIGenerating(store)) return;
    const canNotSend = threadSelectors.isSendButtonDisabledByMessage(store);

    if (canNotSend) return;

    const threadInputEditor = store.threadInputEditor;

    if (!threadInputEditor) {
      console.warn('not found threadInputEditor instance');
      return;
    }

    const inputMessage = threadInputEditor.getMarkdownContent();

    // if there is no message and no image, then we should not send the message
    if (!inputMessage) return;

    // Check for Chinese text warning with Gemini model
    const agentStore = getAgentStoreState();
    const currentModel = agentSelectors.currentAgentModel(agentStore);
    const shouldContinue = await checkGeminiChineseWarning({
      model: currentModel,
      prompt: inputMessage,
      scenario: 'chat',
    });

    if (!shouldContinue) return;

    updateInputMessage(inputMessage);

    sendMessage({ message: inputMessage, ...params });

    updateInputMessage('');
    threadInputEditor.clearContent();
    threadInputEditor.focus();
  };

  const send = async (params: UseSendMessageParams = {}) => {
    setLoading(true);
    await handleSend(params);
    setLoading(false);
  };

  return useMemo(
    () => ({ disabled: canNotSend, generating, loading, send, stop }),
    [canNotSend, send, generating, stop, loading],
  );
};
