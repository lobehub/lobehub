import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { usePublishAgentToWorkspace } from './usePublishAgentToWorkspace';

export { usePublishAgentToWorkspace } from './usePublishAgentToWorkspace';

/**
 * Returns a callback for "a link into this agent was just copied". In a
 * workspace, a private agent's link opens for nobody but its creator, so the
 * confirmation warns about that and offers publishing right there. Returns
 * `true` when it showed the warning, so the caller can skip its plain success
 * toast.
 */
export const usePrivateAgentLinkNotice = () => {
  const { t } = useTranslation('chat');
  const activeWorkspaceId = useActiveWorkspaceId();
  const publishAgent = usePublishAgentToWorkspace();

  return useCallback(
    async (agentId: string | undefined) => {
      if (!activeWorkspaceId || !agentId) return false;

      const readVisibility = () =>
        agentSelectors.getAgentVisibilityById(agentId)(useAgentStore.getState());
      // A row of a cold project visit may point at an agent whose config was
      // never loaded; load it before deciding which confirmation to show.
      if (!readVisibility()) {
        try {
          await useAgentStore.getState().prefetchAgentConfig(agentId);
        } catch {
          return false;
        }
      }
      if (readVisibility() !== 'private') return false;

      toast.warning({
        actions: [{ label: t('agent.publishToWorkspace'), onClick: () => publishAgent(agentId) }],
        description: t('privateAgentLink.desc'),
        duration: 8000,
        id: `private-agent-link-${agentId}`,
        title: t('privateAgentLink.title'),
      });
      return true;
    },
    [activeWorkspaceId, publishAgent, t],
  );
};
