import { AGENT_CHAT_TOPIC_URL, AGENT_CHAT_URL } from '@lobechat/const';
import { useCallback, useState } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildTaskHandoffPath } from '@/features/AgentTaskManager/taskHandoff';
import type { SendButtonHandler } from '@/features/ChatInput/store/initialState';
import { buildMessageContextSelections } from '@/features/ChatInput/utils/contextSelections';
import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { usePageStore } from '@/store/page';

import type { HomeMode } from '../types';

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

export const useSend = (mode: HomeMode = 'chat') => {
  const router = useQueryRoute();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const clearChatUploadFileList = useFileStore((s) => s.clearChatUploadFileList);
  const clearChatContextSelections = useFileStore((s) => s.clearChatContextSelections);

  const homeInputLoading = useHomeStore((s) => s.homeInputLoading);
  const createNewPage = usePageStore((s) => s.createNewPage);
  const toggleTaskAgentPanel = useGlobalStore((s) => s.toggleTaskAgentPanel);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Home is owned by Inbox. Mode switching changes the business event, never
  // the visible or runtime agent identity.
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

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
      const fileList = fileChatSelectors.chatUploadFileList(useFileStore.getState());
      const contextList = fileChatSelectors.chatContextSelections(useFileStore.getState());
      const { sendAsAgent, sendAsGroup, sendAsWrite, sendAsResearch, inputActiveMode } =
        useHomeStore.getState();

      // If the user pressed Enter on an empty input, fall back to the
      // currently displayed daily-brief hint (with cosmetic ellipsis stripped)
      // and rotate the carousel so the next press shows / sends a different
      // pair.
      const hint = mode === 'chat' && currentPair?.hint ? stripHintEllipsis(currentPair.hint) : '';
      const usedHint = !typed && !!hint;
      const message = typed || hint;
      if (usedHint) advance();

      // When falling back to the hint, the editor is empty — but its JSON
      // state still contains root nodes (e.g. `{ type: 'doc' }`), which is
      // truthy under `Object.keys(editorData).length > 0`. That makes the
      // user-message renderer take the RichTextMessage branch and draw
      // nothing, so the chat shows a blank user bubble while the agent
      // happily processes the hint text. Skip editorData in that case so
      // the renderer falls back to the markdown `content`.
      const editorData = usedHint
        ? undefined
        : (getEditorData?.() ?? mainInputEditor?.getJSONState());

      // Require input content (except for default inbox which can have files/context)
      if (!message && fileList.length === 0 && contextList.length === 0) return;

      try {
        const { contextSelections, pageSelections } = buildMessageContextSelections(contextList);

        if (mode === 'note') {
          if (!message) return;
          setIsSubmitting(true);
          const pageId = await createNewPage(message);
          router.push(`/page/${pageId}`);
          return;
        }

        if (mode === 'task') {
          if (!message || !inboxAgentId) return;
          setIsSubmitting(true);
          await ensureAgentConfigLoaded(inboxAgentId);
          const result = await sendMessage({
            context: {
              agentId: inboxAgentId,
              defaultTaskAssigneeAgentId: inboxAgentId,
              scope: 'task',
              ...(activeWorkspaceSlug ? { workspaceSlug: activeWorkspaceSlug } : {}),
            },
            contextSelections,
            contexts: contextList,
            editorData,
            files: fileList,
            message,
            pageSelections,
          });
          if (!result?.createdTopicId) return;
          toggleTaskAgentPanel(true);
          router.push(buildTaskHandoffPath(inboxAgentId, result.createdTopicId));
          return;
        }

        switch (inputActiveMode) {
          case 'agent': {
            await sendAsAgent({
              contextSelections,
              editorData,
              message,
              pageSelections,
              workspaceSlug: activeWorkspaceSlug,
            });
            break;
          }

          case 'group': {
            await sendAsGroup({
              contextSelections,
              editorData,
              message,
              pageSelections,
              workspaceSlug: activeWorkspaceSlug,
            });
            break;
          }

          case 'write': {
            await sendAsWrite({
              contextSelections,
              editorData,
              message,
              pageSelections,
              workspaceSlug: activeWorkspaceSlug,
            });
            break;
          }

          case 'research': {
            await sendAsResearch(message);
            break;
          }

          default: {
            if (!inboxAgentId) return;

            await ensureAgentConfigLoaded(inboxAgentId);

            sendMessage({
              context: {
                agentId: inboxAgentId,
                isolatedTopic: true,
                ...(activeWorkspaceSlug ? { workspaceSlug: activeWorkspaceSlug } : {}),
              },
              contextSelections,
              contexts: contextList,
              editorData,
              files: fileList,
              message,
              onTopicCreated: (topicId) => {
                router.replace(AGENT_CHAT_TOPIC_URL(inboxAgentId, topicId, false));
              },
              pageSelections,
            });

            router.push(AGENT_CHAT_URL(inboxAgentId, false));
          }
        }
      } finally {
        // Clear input and files after send
        clearChatUploadFileList();
        clearChatContextSelections();
        mainInputEditor?.clearContent();
        setIsSubmitting(false);
      }
    },
    [
      activeWorkspaceSlug,
      sendMessage,
      clearChatContextSelections,
      clearChatUploadFileList,
      router,
      currentPair,
      advance,
      mode,
      createNewPage,
      inboxAgentId,
      toggleTaskAgentPanel,
    ],
  );

  return {
    agentId: inboxAgentId,
    loading: homeInputLoading || isSubmitting,
    send,
  };
};
