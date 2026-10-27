import { useState } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import type { SendButtonHandler } from '@/features/ChatInput/store/initialState';
import { appendTaskAttachments } from '@/features/Home/InputArea/taskAttachments';
import { taskNameFromMessage } from '@/features/Home/InputArea/taskName';
import { getProjectTopicPath } from '@/features/Projects/Layout/navigation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { agentService } from '@/services/agent';
import { topicService } from '@/services/topic';
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

export class AttachmentsNotReadyError extends Error {
  constructor() {
    super('Attachments are still uploading');
    this.name = 'AttachmentsNotReadyError';
  }
}

/** The send was refused before the message reached the conversation; the draft stays. */
export class MessageNotAcceptedError extends Error {
  constructor() {
    super('The message was not accepted');
    this.name = 'MessageNotAcceptedError';
  }
}

export const useProjectComposer = (
  project: ProjectDetail['project'],
  mode: ProjectComposerMode,
  /** The project agent the message goes to; the main agent unless the user picked another. */
  agentId: string,
) => {
  const navigate = useWorkspaceAwareNavigate();
  const workspaceSlug = useActiveWorkspaceSlug();
  const createProjectTopic = useProjectDirectoryStore((s) => s.createProjectTopic);
  const refreshProjectTopics = useProjectDirectoryStore((s) => s.refreshProjectTopics);
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
      // Leave the composer only once the conversation owns the message. A send
      // refused before that (access, device or preflight checks) either rejects
      // or resolves without accepting, and with `inputEditor: null` nothing
      // would put the draft back — so it stays here until then.
      const accepted = await new Promise<boolean>((resolve) => {
        sendMessage({
          context: { agentId, topicId: topic.id, ...(workspaceSlug ? { workspaceSlug } : {}) },
          editorData,
          files,
          inputEditor: null,
          message,
          onMessageAccepted: () => resolve(true),
        }).then(
          () => resolve(false),
          (error) => {
            console.error('[ProjectComposer] send failed', error);
            resolve(false);
          },
        );
      });
      if (!accepted) {
        // Don't leave an empty conversation behind for every failed attempt.
        await topicService
          .removeTopic(topic.id)
          .then(() => refreshProjectTopics(project.id))
          .catch((error) =>
            console.error('[ProjectComposer] failed to drop the empty topic', error),
          );
        throw new MessageNotAcceptedError();
      }
      clearContent();
      clearChatUploadFileList();
      navigate(getProjectTopicPath(project.slug ?? project.id, topic.id));
    } finally {
      setSending(false);
    }
  };

  return { send, sending };
};
