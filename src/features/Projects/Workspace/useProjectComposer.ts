import { type IEditor } from '@lobehub/editor';
import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import type { ChatInputEditor } from '@/features/ChatInput';
import type { SendButtonHandler } from '@/features/ChatInput/store/initialState';
import { appendTaskAttachments } from '@/features/Home/InputArea/taskAttachments';
import { taskNameFromMessage } from '@/features/Home/InputArea/taskName';
import { getProjectTopicPath } from '@/features/Projects/Layout/navigation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
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

/** How long a refused draft waits for the conversation's composer to mount. */
const COMPOSER_MOUNT_TIMEOUT = 10_000;

/**
 * Runs `apply` on the conversation's composer, waiting for it to mount when
 * the send fails before the page has rendered it.
 */
const withConversationEditor = (apply: (editor: ChatInputEditor) => void) => {
  const editor = useChatStore.getState().mainInputEditor;
  if (editor) return apply(editor);

  const timer = setTimeout(() => unsubscribe(), COMPOSER_MOUNT_TIMEOUT);
  const unsubscribe = useChatStore.subscribe((state) => {
    if (!state.mainInputEditor) return;
    clearTimeout(timer);
    unsubscribe();
    apply(state.mainInputEditor);
  });
};

/**
 * The composer that owns a send from the project home: the conversation page's,
 * which mounts only after the navigation. It is looked up when the send needs
 * it — to put a refused draft back — not when the send starts.
 */
export const conversationComposer: ChatInputEditor = {
  clearContent: () => withConversationEditor((editor) => editor.clearContent()),
  focus: () => withConversationEditor((editor) => editor.focus()),
  getJSONState: () => useChatStore.getState().mainInputEditor?.getJSONState(),
  getMarkdownContent: () => useChatStore.getState().mainInputEditor?.getMarkdownContent() ?? '',
  get instance() {
    return useChatStore.getState().mainInputEditor?.instance as IEditor;
  },
  setDocument: (type, content, options) =>
    withConversationEditor((editor) => editor.setDocument(type, content, options)),
  setExpand: (expand) => withConversationEditor((editor) => editor.setExpand(expand)),
  setJSONState: (content) => withConversationEditor((editor) => editor.setJSONState(content)),
};

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

      let accepted = false;
      let restored = false;
      const restoreFiles = () => {
        restored = true;
        useFileStore.getState().restoreChatUploadFileList(files);
      };
      sendMessage({
        context: { agentId, topicId: topic.id, ...(workspaceSlug ? { workspaceSlug } : {}) },
        editorData,
        files,
        inputEditor: conversationComposer,
        message,
        onMessageAccepted: () => {
          accepted = true;
        },
        // The send already put the text back into the composer it names.
        onPreflightFailure: restoreFiles,
      }).catch((error) => {
        console.error('[ProjectComposer] send failed', error);
        if (accepted || restored) return;
        // A refusal thrown before the send reached its own recovery.
        if (editorData) conversationComposer.setJSONState(editorData);
        else conversationComposer.setDocument('markdown', message);
        restoreFiles();
        toast.error(t('overview.messageNotSent'));
      });
    } finally {
      setSending(false);
    }
  };

  return { send, sending };
};
