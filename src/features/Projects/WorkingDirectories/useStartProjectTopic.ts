import { toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { getProjectTopicPath } from '../Layout/navigation';
import { startProjectTopicDraft } from './startProjectTopicDraft';

/**
 * Every project "new topic" goes straight into the agent's conversation, never
 * through a picker. On a directory the agent can run in it opens a blank draft
 * that the first message turns into a topic. Otherwise it creates the topic
 * up front — bound to `bindDirectoryId` when the caller names a directory the
 * draft can't stage on, else conversation-only — since a draft needs both.
 */
export const useStartProjectTopic = (projectId: string | undefined) => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const createProjectTopic = useProjectDirectoryStore((s) => s.createProjectTopic);
  const startDirectoryTopic = useProjectDirectoryStore((s) => s.startTopic);

  return async ({
    agentId,
    bindDirectoryId,
    directoryId,
  }: {
    agentId: string;
    bindDirectoryId?: string;
    directoryId?: string;
  }) => {
    if (!projectId) return;
    if (directoryId) {
      startProjectTopicDraft({ agentId, directoryId, navigate, projectId });
      return;
    }
    try {
      const title = t('directories.untitled');
      const topic = bindDirectoryId
        ? await startDirectoryTopic(bindDirectoryId, agentId, title)
        : await createProjectTopic({ agentId, projectId, title });
      navigate(getProjectTopicPath(projectId, topic.id));
    } catch (error) {
      console.error('Failed to start a project topic', error);
      toast.error(t('overview.sendFailed'));
    }
  };
};
