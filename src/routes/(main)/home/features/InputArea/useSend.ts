import { SESSION_CHAT_TOPIC_URL, SESSION_CHAT_URL } from '@lobechat/const';
import { useCallback } from 'react';

import type { SendButtonHandler } from '@/features/ChatInput/store/initialState';
import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { useHomeStore } from '@/store/home';

import { useResolvedHomeAgentId } from '../AgentSelect/useResolvedHomeAgentId';

/**
 * Trim trailing ellipsis the LLM uses on hint placeholders so the sent
 * message doesn't carry the cosmetic suffix.
 */
const stripHintEllipsis = (hint: string): string => hint.replace(/\s*(?:\.{3,}|…)\s*$/, '').trim();

/**
 * Make sure the agent's config is hydrated into `agentMap` before we call
 * `sendMessage`. Without this, sending to an agent the user just picked from
 * the home AgentSelect (and never opened in this session) silently fails:
 * `sendMessage` reaches `getAgentConfigById(agentId)` which returns `undefined`
 * from `agentMap`, the `{ model, provider }` destructure throws, and the
 * surrounding catch swallows it — so the chat page mounts with optimistic
 * messages but the runtime never starts.
 */
const ensureAgentConfigLoaded = async (agentId: string): Promise<void> => {
  const agentState = useAgentStore.getState();
  if (agentState.agentMap[agentId]) return;
  const config = await agentService.getAgentConfigById(agentId);
  if (config) agentState.internal_dispatchAgentMap(agentId, config);
};

export const useSend = () => {
  const router = useQueryRoute();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const clearChatUploadFileList = useFileStore((s) => s.clearChatUploadFileList);
  const clearChatContextSelections = useFileStore((s) => s.clearChatContextSelections);

  const homeInputLoading = useHomeStore((s) => s.homeInputLoading);

  // Resolve the agent that the home input is currently bound to. Defaults to the
  // inbox agent; AgentSelect can override via systemStatus.homeSelectedAgentId.
  // The hook also rewrites stale ids (e.g. left over from a different account
  // on the same browser) back to inbox so we don't try to send to a missing id.
  const { agentId: activeAgentId } = useResolvedHomeAgentId();

  // Daily-brief hint paired with the home WelcomeText. Pressing Enter on an
  // empty input "accepts" the hint as the message — like a smart-compose
  // suggestion — and rotates to the next pair.
  const { currentPair, advance } = useHomeDailyBrief();

  const send = useCallback<SendButtonHandler>(
    async ({ getEditorData, getMarkdownContent }) => {
      const { inputMessage, mainInputEditor } = useChatStore.getState();
      // Prefer the live editor content over the cached `inputMessage`.
      // `onMarkdownContentChange` is wired through the editor's async
      // `onChange`, so a fast type-then-Enter sequence can fire before the
      // cache catches up and the empty-message guard would bail incorrectly.
      const typed = (getMarkdownContent?.() ?? inputMessage ?? '').trim();
      const editorData = getEditorData?.() ?? mainInputEditor?.getJSONState();
      const fileList = fileChatSelectors.chatUploadFileList(useFileStore.getState());
      const contextList = fileChatSelectors.chatContextSelections(useFileStore.getState());
      const { sendAsAgent, sendAsGroup, sendAsWrite, sendAsResearch, inputActiveMode } =
        useHomeStore.getState();

      // If the user pressed Enter on an empty input, fall back to the
      // currently displayed daily-brief hint (with cosmetic ellipsis stripped)
      // and rotate the carousel so the next press shows / sends a different
      // pair.
      const hint = currentPair?.hint ? stripHintEllipsis(currentPair.hint) : '';
      const usedHint = !typed && !!hint;
      const message = typed || hint;
      if (usedHint) advance();

      // Require input content (except for default inbox which can have files/context)
      if (!message && fileList.length === 0 && contextList.length === 0) return;

      try {
        switch (inputActiveMode) {
          case 'agent': {
            await sendAsAgent({ editorData, message });
            break;
          }

          case 'group': {
            await sendAsGroup({ editorData, message });
            break;
          }

          case 'write': {
            await sendAsWrite({ editorData, message });
            break;
          }

          case 'research': {
            await sendAsResearch(message);
            break;
          }

          default: {
            // Default behavior: send to currently selected agent (inbox by default,
            // overridable via the home AgentSelect dropdown).
            if (!activeAgentId) return;

            // First-time selections from AgentSelect have no entry in `agentMap`
            // yet — block on the fetch so sendMessage finds a real config below.
            await ensureAgentConfigLoaded(activeAgentId);

            sendMessage({
              context: { agentId: activeAgentId, isolatedTopic: true },
              contexts: contextList,
              editorData,
              files: fileList,
              message,
              onTopicCreated: (topicId) => {
                router.replace(SESSION_CHAT_TOPIC_URL(activeAgentId, topicId, false));
              },
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
    [
      activeAgentId,
      sendMessage,
      clearChatContextSelections,
      clearChatUploadFileList,
      router,
      currentPair,
      advance,
    ],
  );

  return {
    agentId: activeAgentId,
    loading: homeInputLoading,
    send,
  };
};
