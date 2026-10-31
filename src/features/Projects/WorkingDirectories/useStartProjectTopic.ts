import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { canStageDraftOn, startProjectTopicDraft } from './startProjectTopicDraft';
import { useAgentFixedDeviceId } from './useAgentFixedDeviceId';

/**
 * Every project "new topic" goes straight into the agent's conversation, never
 * through a picker, and never creates a row up front. It opens a blank draft —
 * on `directoryId` when the agent can run there, else conversation-only in the
 * project — that the first message turns into a topic.
 */
export const useStartProjectTopic = (projectId: string | undefined) => {
  const navigate = useWorkspaceAwareNavigate();

  return ({ agentId, directoryId }: { agentId: string; directoryId?: string }) => {
    if (!projectId) return;
    startProjectTopicDraft({ agentId, directoryId, navigate, projectId });
  };
};

/**
 * "Start a conversation" on one project directory: a blank draft on it when
 * `agentId` can run there, else a conversation-only draft in the project.
 */
export const useStartDirectoryConversation = (
  projectId: string | undefined,
  agentId: string | undefined,
) => {
  const startTopic = useStartProjectTopic(projectId);
  const fixedDeviceId = useAgentFixedDeviceId(agentId);

  return (directory: Parameters<typeof canStageDraftOn>[0] & { id: string }) => {
    if (!agentId) return;
    startTopic({
      agentId,
      directoryId: canStageDraftOn(directory, fixedDeviceId) ? directory.id : undefined,
    });
  };
};
