import { SESSION_CHAT_URL } from '@lobechat/const';
import { useCallback } from 'react';

import type { SendButtonHandler } from '@/features/ChatInput/store/initialState';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';

export const useSend = () => {
  const router = useQueryRoute();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const selectedAgentId = useGlobalStore(systemStatusSelectors.homeSelectedAgentId);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const clearChatUploadFileList = useFileStore((s) => s.clearChatUploadFileList);
  const clearChatContextSelections = useFileStore((s) => s.clearChatContextSelections);

  const homeInputLoading = useHomeStore((s) => s.homeInputLoading);

  // Resolve the agent that the home input is currently bound to. Defaults to the
  // inbox agent; AgentSelect can override by setting selectedAgentId in home store.
  const activeAgentId = selectedAgentId ?? inboxAgentId;

  const send = useCallback<SendButtonHandler>(
    async ({ getEditorData }) => {
      const { inputMessage, mainInputEditor } = useChatStore.getState();
      const editorData = getEditorData?.() ?? mainInputEditor?.getJSONState();
      const fileList = fileChatSelectors.chatUploadFileList(useFileStore.getState());
      const contextList = fileChatSelectors.chatContextSelections(useFileStore.getState());
      const { sendAsAgent, sendAsGroup, sendAsWrite, sendAsResearch, inputActiveMode } =
        useHomeStore.getState();

      // Require input content (except for default inbox which can have files/context)
      if (!inputMessage && fileList.length === 0 && contextList.length === 0) return;

      try {
        switch (inputActiveMode) {
          case 'agent': {
            await sendAsAgent({ editorData, message: inputMessage });
            break;
          }

          case 'group': {
            await sendAsGroup({ editorData, message: inputMessage });
            break;
          }

          case 'write': {
            await sendAsWrite({ editorData, message: inputMessage });
            break;
          }

          case 'research': {
            await sendAsResearch(inputMessage);
            break;
          }

          default: {
            // Default behavior: send to currently selected agent (inbox by default,
            // overridable via the home AgentSelect dropdown).
            if (!activeAgentId) return;

            sendMessage({
              context: { agentId: activeAgentId },
              contexts: contextList,
              editorData,
              files: fileList,
              message: inputMessage,
            });

            router.push(SESSION_CHAT_URL(activeAgentId, false));
          }
        }
      } finally {
        // Clear input and files after send
        clearChatUploadFileList();
        clearChatContextSelections();
        mainInputEditor?.clearContent();
      }
    },
    [activeAgentId, sendMessage, clearChatContextSelections, clearChatUploadFileList, router],
  );

  return {
    agentId: activeAgentId,
    loading: homeInputLoading,
    send,
  };
};
