import { AGENT_CHAT_TOPIC_URL, AGENT_CHAT_URL } from '@lobechat/const';
import { toast } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import type { SendButtonHandler } from '@/features/ChatInput/store/initialState';
import { buildMessageContextSelections } from '@/features/ChatInput/utils/contextSelections';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { useHomeStore } from '@/store/home';
import { useTaskStore } from '@/store/task';

import { useResolvedHomeAgentId } from '../AgentSelect/useResolvedHomeAgentId';
import type { HomeMode } from '../types';
import { appendTaskAttachments } from './taskAttachments';
import { taskNameFromMessage } from './taskName';

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
  const { t } = useTranslation('home');
  const { t: tChat } = useTranslation('chat');
  const router = useQueryRoute();
  const activeWorkspaceId = useActiveWorkspaceId();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const clearChatUploadFileList = useFileStore((s) => s.clearChatUploadFileList);
  const clearChatContextSelections = useFileStore((s) => s.clearChatContextSelections);
  const restoreChatContextSelections = useFileStore((s) => s.restoreChatContextSelections);

  const homeInputLoading = useHomeStore((s) => s.homeInputLoading);
  const createTask = useTaskStore((s) => s.createTask);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const { agentId: selectedAgentId } = useResolvedHomeAgentId();
  const agentId = selectedAgentId;
  const contextSelectionKey = `home:${mode}:${selectedAgentId ?? 'unresolved'}`;
  const { allowed: canCreateContent } = usePermission('create_content');
  const agentVisibility = useAgentStore((s) =>
    selectedAgentId ? s.agentMap[selectedAgentId]?.visibility : undefined,
  );
  const gatedResourceId =
    selectedAgentId && selectedAgentId !== inboxAgentId && agentVisibility !== 'private'
      ? selectedAgentId
      : undefined;
  const { canUseResource } = useResourceAccess('agent', gatedResourceId);

  // Daily-brief hint paired with the fixed Home greeting. Pressing Enter on an
  // empty input accepts that hint without changing the visible pair.
  const { currentPair } = useHomeDailyBrief();

  const send = useCallback<SendButtonHandler>(
    async ({ getEditorData, getMarkdownContent }) => {
      const { inputMessage, mainInputEditor } = useChatStore.getState();
      // Prefer the live editor content over the cached `inputMessage`.
      // `onMarkdownContentChange` is wired through the editor's async
      // `onChange`, so a fast type-then-Enter sequence can fire before the
      // cache catches up and the empty-message guard would bail incorrectly.
      const typed = (getMarkdownContent?.() ?? inputMessage ?? '').trim();
      const fileList = fileChatSelectors.chatUploadFileList(useFileStore.getState());
      const contextList = fileChatSelectors.chatContextSelections(contextSelectionKey)(
        useFileStore.getState(),
      );
      const { sendAsAgent, sendAsGroup, sendAsWrite, sendAsResearch, inputActiveMode } =
        useHomeStore.getState();

      // If the user pressed Enter on an empty input, fall back to the
      // currently displayed daily-brief hint (with cosmetic ellipsis stripped)
      // and rotate the carousel so the next press shows / sends a different
      // pair.
      const hint = mode === 'chat' && currentPair?.hint ? stripHintEllipsis(currentPair.hint) : '';
      const usedHint = !typed && !!hint;
      const message = typed || hint;

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

      if (!canCreateContent) return;

      if ((mode === 'task' || !inputActiveMode) && !canUseResource) return;

      // Selected context is separate from the task editor's persisted attachments.
      if (mode === 'task' && contextList.length > 0) {
        toast.error(t('dashboard.task.unsupportedContext'));
        return;
      }

      // Require input content (except for default inbox which can have files/context)
      if (!message && fileList.length === 0 && contextList.length === 0) return;

      let submitted = false;
      try {
        const { contextSelections, pageSelections } = buildMessageContextSelections(contextList);

        // Task mode records a task; it does not start one. Pressing send here
        // writes the row and keeps the user on the Home composer, where the new
        // task shows up under Recent tasks. Starting the run stays an explicit
        // action on the task itself, so a quick jot cannot launch an agent the
        // user only meant to note down.
        if (mode === 'task') {
          if (!selectedAgentId) return;
          if (fileList.some((file) => file.status !== 'success' || !file.fileUrl)) {
            toast.error(t('dashboard.task.attachmentsNotReady'));
            return;
          }
          setIsSubmitting(true);
          const name = taskNameFromMessage(message || fileList[0]?.file.name || '');
          const created = await createTask({
            assigneeAgentId: selectedAgentId,
            editorData: appendTaskAttachments(editorData, message, fileList),
            instruction: message || name,
            name,
            visibility: activeWorkspaceId ? 'private' : undefined,
          });
          if (!created?.identifier) throw new Error('Task creation returned no identifier');
          submitted = true;
          // The task outlives the toast, so the toast is the only handle on the
          // thing the user just wrote. Say where it went and give it a way in,
          // mirroring the task list's own create toast.
          toast.success({
            actions: [
              {
                label: tChat('taskIntent.openCreated'),
                onClick: () =>
                  router.push(
                    taskDetailPath(
                      created.identifier,
                      created.assigneeAgentId ?? selectedAgentId,
                      name,
                    ),
                  ),
                variant: 'text',
              },
            ],
            description: t('dashboard.task.createdHint'),
            title: t('dashboard.task.created'),
          });
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
            submitted = true;
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
            submitted = true;
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
            submitted = true;
            break;
          }

          case 'research': {
            await sendAsResearch(message);
            submitted = true;
            break;
          }

          default: {
            if (!selectedAgentId) return;

            await ensureAgentConfigLoaded(selectedAgentId);

            sendMessage({
              context: {
                agentId: selectedAgentId,
                isolatedTopic: true,
                ...(activeWorkspaceSlug ? { workspaceSlug: activeWorkspaceSlug } : {}),
              },
              contextSelections,
              contexts: contextList,
              editorData,
              files: fileList,
              message,
              onPreflightFailure: () => {
                restoreChatContextSelections(contextSelectionKey, contextList);
              },
              onTopicCreated: (topicId) => {
                router.replace(AGENT_CHAT_TOPIC_URL(selectedAgentId, topicId, false));
              },
              pageSelections,
            });

            submitted = true;
            router.push(AGENT_CHAT_URL(selectedAgentId, false));
          }
        }
      } catch (error) {
        console.error('[home:send]', error);
        toast.error(t('dashboard.submitFailed'));
      } finally {
        // Preserve the complete draft when creation or execution fails. The
        // editor, files and context are one unit from the user's perspective.
        if (submitted) {
          clearChatUploadFileList(mode === 'task' ? fileList.map((file) => file.id) : undefined);
          clearChatContextSelections(contextSelectionKey);
          mainInputEditor?.clearContent();
        }
        setIsSubmitting(false);
      }
    },
    [
      activeWorkspaceSlug,
      activeWorkspaceId,
      sendMessage,
      clearChatContextSelections,
      restoreChatContextSelections,
      clearChatUploadFileList,
      contextSelectionKey,
      router,
      currentPair,
      mode,
      createTask,
      inboxAgentId,
      selectedAgentId,
      canUseResource,
      canCreateContent,
      t,
      tChat,
    ],
  );

  return {
    agentId,
    contextSelectionKey,
    loading: homeInputLoading || isSubmitting,
    send,
  };
};
