import { type IEditor } from '@lobehub/editor';
import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import type { ChatInputEditor } from '@/features/ChatInput';
import { saveDraft } from '@/features/ChatInput/draftStorage';
import type { SendButtonHandler } from '@/features/ChatInput/store/initialState';
import { appendTaskAttachments } from '@/features/Home/InputArea/taskAttachments';
import { taskNameFromMessage } from '@/features/Home/InputArea/taskName';
import { getProjectTopicPath } from '@/features/Projects/Layout/navigation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { fileChatSelectors, useFileStore } from '@/store/file';
import type { ProjectDetail } from '@/store/project';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';
import { useTaskStore } from '@/store/task';

/**
 * `chat` hands the message to the chosen project agent in a new project
 * conversation. `task` records it as a task for that agent straight away,
 * without a model round trip.
 */
export type ProjectComposerMode = 'chat' | 'task';

const TITLE_LENGTH = 50;

/** A conversation is titled by its first line until the agent renames it. */
export const toConversationTitle = (message: string) => {
  const firstLine = message.trim().split('\n')[0].trim();
  return firstLine.length > TITLE_LENGTH ? `${firstLine.slice(0, TITLE_LENGTH)}…` : firstLine;
};

/** `sendMessage` reads the agent's model from `agentMap`; hydrate it first. */
const ensureAgentConfigLoaded = async (agentId: string) => {
  const agentState = useAgentStore.getState();
  if (agentState.agentMap[agentId]) return;
  const config = await agentService.getAgentConfigById(agentId);
  if (config) agentState.internal_dispatchAgentMap(agentId, config);
};

/**
 * The composer that owns a send from the project home: the conversation page's,
 * which mounts only after the navigation. It is looked up when the send needs
 * it — to put a refused draft back — not when the send starts, and only while
 * that conversation is the open one: every conversation registers as the main
 * editor, so a user who has moved on keeps their own draft. Otherwise the draft
 * goes to the drafts that composer restores for this conversation — also before
 * it has mounted, since it settles its document after it first registers and
 * would wipe a draft written into the editor directly.
 */
export const createConversationComposer = (conversation: { agentId: string; topicId: string }) => {
  const draftKey = messageMapKey(conversation);
  let textRestored = false;
  const mounted = () => {
    const { activeAgentId, activeTopicId, mainInputEditor } = useChatStore.getState();
    return activeAgentId === conversation.agentId && activeTopicId === conversation.topicId
      ? mainInputEditor
      : null;
  };

  const editor: ChatInputEditor = {
    clearContent: () => mounted()?.clearContent(),
    focus: () => mounted()?.focus(),
    getJSONState: () => mounted()?.getJSONState(),
    getMarkdownContent: () => mounted()?.getMarkdownContent() ?? '',
    get instance() {
      return mounted()?.instance as IEditor;
    },
    // Only the plain-text fallback for a send without editor data comes here.
    setDocument: (type, content, options) => {
      textRestored = true;
      mounted()?.setDocument(type, content, options);
    },
    setExpand: (expand) => mounted()?.setExpand(expand),
    setJSONState: (content) => {
      textRestored = true;
      const current = mounted();
      if (current) current.setJSONState(content);
      else saveDraft(draftKey, content);
    },
  };

  /** Whether the send has put the text back; attachments are reported apart. */
  return { editor, textRestored: () => textRestored };
};

/** A user's stop restores the draft through the stop flow itself. */
const isAbort = (error: unknown) =>
  error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));

export class AttachmentsNotReadyError extends Error {
  constructor() {
    super('Attachments are still uploading');
    this.name = 'AttachmentsNotReadyError';
  }
}

export const useProjectComposer = (
  project: ProjectDetail['project'],
  mode: ProjectComposerMode,
  /** The project agent the message goes to; the main agent unless the user picked another. */
  agentId: string,
) => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const workspaceSlug = useActiveWorkspaceSlug();
  const createProjectTopic = useProjectDirectoryStore((s) => s.createProjectTopic);
  const createTask = useTaskStore((s) => s.createTask);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const clearChatUploadFileList = useFileStore((s) => s.clearChatUploadFileList);
  const [sending, setSending] = useState(false);

  /** Rejects when nothing left the composer, so the caller can report it. */
  const send: SendButtonHandler = async ({ clearContent, getEditorData, getMarkdownContent }) => {
    const message = getMarkdownContent().trim();
    const files = fileChatSelectors.chatUploadFileList(useFileStore.getState());
    if ((!message && files.length === 0) || sending) return;
    if (files.some((file) => file.status !== 'success' || !file.fileUrl))
      throw new AttachmentsNotReadyError();

    const editorData = getEditorData();
    const title = toConversationTitle(message || files[0].file.name);

    setSending(true);
    try {
      if (mode === 'task') {
        const task = await createTask({
          assigneeAgentId: agentId,
          editorData: appendTaskAttachments(editorData, message, files),
          instruction: message || title,
          name: taskNameFromMessage(message || title),
          projectId: project.id,
        });
        clearContent();
        clearChatUploadFileList(files.map((file) => file.id));
        if (task) navigate(taskDetailPath(task.identifier, undefined, task.name));
        return;
      }

      // The conversation is created inside the project first, so the project
      // owns it from the start, and the message is sent into that exact topic.
      // Sending here rather than after the page loads keeps the attachments,
      // which cannot travel through the URL.
      const [topic] = await Promise.all([
        createProjectTopic({ agentId, projectId: project.id, title }),
        ensureAgentConfigLoaded(agentId),
      ]);
      // Open the conversation right away: the send shows its message there
      // optimistically instead of holding this composer until the server has
      // accepted it. From here the conversation's composer owns the draft, so a
      // refused send puts it back there rather than here.
      clearContent();
      clearChatUploadFileList();
      navigate(getProjectTopicPath(project.slug ?? project.id, topic.id));

      const conversation = createConversationComposer({ agentId, topicId: topic.id });
      let accepted = false;
      let filesRestored = false;
      const restoreFiles = () => {
        filesRestored = true;
        useFileStore.getState().restoreChatUploadFileList(files);
      };
      sendMessage({
        context: { agentId, topicId: topic.id, ...(workspaceSlug ? { workspaceSlug } : {}) },
        editorData,
        files,
        inputEditor: conversation.editor,
        message,
        onMessageAccepted: () => {
          accepted = true;
        },
        onPreflightFailure: restoreFiles,
      }).catch((error) => {
        console.error('[ProjectComposer] send failed', error);
        if (accepted || isAbort(error)) return;
        // Some refusals hand back only the attachments before rejecting (a
        // skill or local file that cannot be read): put back whatever the send
        // did not.
        if (!filesRestored) restoreFiles();
        if (conversation.textRestored()) return;
        if (editorData) conversation.editor.setJSONState(editorData);
        else conversation.editor.setDocument('markdown', message);
        toast.error(t('overview.messageNotSent'));
      });
    } finally {
      setSending(false);
    }
  };

  return { send, sending };
};
