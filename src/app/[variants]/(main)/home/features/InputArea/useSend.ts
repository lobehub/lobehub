import { SESSION_CHAT_URL } from '@lobechat/const';
import { useCallback } from 'react';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { useHomeStore } from '@/store/home';

export const useSend = () => {
  const router = useQueryRoute();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const clearChatUploadFileList = useFileStore((s) => s.clearChatUploadFileList);
  const clearChatContextSelections = useFileStore((s) => s.clearChatContextSelections);

  const homeInputLoading = useHomeStore((s) => s.homeInputLoading);

  const send = useCallback(async () => {
    const { inputMessage, mainInputEditor } = useChatStore.getState();
    const fileList = fileChatSelectors.chatUploadFileList(useFileStore.getState());
    const contextList = fileChatSelectors.chatContextSelections(useFileStore.getState());
    const { sendAsAgent, sendAsGroup, sendAsWrite, sendAsResearch, inputActiveMode } =
      useHomeStore.getState();

    // Require input content (except for default inbox which can have files/context)
    if (!inputMessage && fileList.length === 0 && contextList.length === 0) return;

    try {
      switch (inputActiveMode) {
        case 'agent': {
          await sendAsAgent(inputMessage);
          break;
        }

        case 'group': {
          await sendAsGroup(inputMessage);
          break;
        }

        case 'write': {
          await sendAsWrite(inputMessage);
          break;
        }

        case 'research': {
          await sendAsResearch(inputMessage);
          break;
        }

        default: {
          // Default inbox behavior
          if (!inboxAgentId) return;

          sendMessage({
            context: { agentId: inboxAgentId },
            contexts: contextList,
            files: fileList,
            message: inputMessage,
          });

          router.push(SESSION_CHAT_URL(inboxAgentId, false));
        }
      }
    } finally {
      // Clear input and files after send
      clearChatUploadFileList();
      clearChatContextSelections();
      mainInputEditor?.clearContent();
    }
  }, [inboxAgentId, sendMessage, clearChatContextSelections, clearChatUploadFileList, router]);

  return {
    inboxAgentId,
    loading: homeInputLoading,
    send,
  };
};
