import { SendMessageParams } from '@lobechat/types';
import { useAnalytics } from '@lobehub/analytics/react';
import { useCallback, useMemo } from 'react';

import { useGeminiChineseWarning } from '@/hooks/useGeminiChineseWarning';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { getUserStoreState } from '@/store/user';

export type UseSendMessageParams = Pick<
  SendMessageParams,
  'onlyAddUserMessage' | 'isWelcomeQuestion'
>;

export const useSendMessage = () => {
  const [sendMessage, updateInputMessage] = useChatStore((s) => [
    s.sendMessage,
    s.updateInputMessage,
  ]);
  const { analytics } = useAnalytics();
  const checkGeminiChineseWarning = useGeminiChineseWarning();

  const clearChatUploadFileList = useFileStore((s) => s.clearChatUploadFileList);

  const isUploadingFiles = useFileStore(fileChatSelectors.isUploadingFiles);
  const isSendButtonDisabledByMessage = useChatStore(chatSelectors.isSendButtonDisabledByMessage);

  const canSend = !isUploadingFiles && !isSendButtonDisabledByMessage;

  const send = useCallback(async (params: UseSendMessageParams = {}) => {
    const store = useChatStore.getState();
    if (chatSelectors.isAIGenerating(store)) return;

    // if uploading file or send button is disabled by message, then we should not send the message
    const isUploadingFiles = fileChatSelectors.isUploadingFiles(useFileStore.getState());
    const isSendButtonDisabledByMessage = chatSelectors.isSendButtonDisabledByMessage(
      useChatStore.getState(),
    );

    const canSend = !isUploadingFiles && !isSendButtonDisabledByMessage;
    if (!canSend) return;

    const fileList = fileChatSelectors.chatUploadFileList(useFileStore.getState());
    // if there is no message and no image, then we should not send the message
    if (!store.inputMessage && fileList.length === 0) return;

    // Check for Chinese text warning with Gemini model
    const agentStore = getAgentStoreState();
    const currentModel = agentSelectors.currentAgentModel(agentStore);
    const shouldContinue = await checkGeminiChineseWarning({
      model: currentModel,
      prompt: store.inputMessage,
      scenario: 'chat',
    });

    if (!shouldContinue) return;

    sendMessage({
      files: fileList,
      message: store.inputMessage,
      ...params,
    });

    updateInputMessage('');
    clearChatUploadFileList();

    // 获取分析数据
    const userStore = getUserStoreState();

    // 直接使用现有数据结构判断消息类型
    const hasImages = fileList.some((file) => file.file?.type?.startsWith('image'));
    const messageType = fileList.length === 0 ? 'text' : hasImages ? 'image' : 'file';

    analytics?.track({
      name: 'send_message',
      properties: {
        chat_id: store.activeId || 'unknown',
        current_topic: topicSelectors.currentActiveTopic(store)?.title || null,
        has_attachments: fileList.length > 0,
        history_message_count: chatSelectors.activeBaseChats(store).length,
        message: store.inputMessage,
        message_length: store.inputMessage.length,
        message_type: messageType,
        selected_model: agentSelectors.currentAgentModel(agentStore),
        session_id: store.activeId || 'inbox', // 当前活跃的会话ID
        user_id: userStore.user?.id || 'anonymous',
      },
    });
    // const hasSystemRole = agentSelectors.hasSystemRole(useAgentStore.getState());
    // const agentSetting = useAgentStore.getState().agentSettingInstance;

    // // if there is a system role, then we need to use agent setting instance to autocomplete agent meta
    // if (hasSystemRole && !!agentSetting) {
    //   agentSetting.autocompleteAllMeta();
    // }
  }, []);

  return useMemo(() => ({ canSend, send }), [canSend]);
};
