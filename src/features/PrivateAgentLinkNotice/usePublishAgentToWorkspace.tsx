import { confirmModal, toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { getAgentPublishErrorKey } from '@/features/AgentVisibility/publishError';
import { useRevealSidebarSection } from '@/features/HomeSidebar/hooks/useRevealSidebarSection';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';

/**
 * Confirm, then publish a private agent to the workspace — the same flow as
 * the sidebar row's "Publish to Workspace", for surfaces outside the sidebar.
 */
export const usePublishAgentToWorkspace = () => {
  const { t } = useTranslation(['chat', 'common']);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const refreshAgentConfig = useAgentStore((s) => s.internal_refreshAgentConfig);
  const refreshWorkspaceUserPreference = useUserStore((s) => s.refreshWorkspaceUserPreference);
  const revealSidebarSection = useRevealSidebarSection();

  return useCallback(
    (agentId: string) =>
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: <VisibilityConfirmContent variant="publish" />,
        okText: t('agent.publishToWorkspace'),
        onOk: async () => {
          try {
            await agentService.publishAgentToWorkspace(agentId);
            // Publishing moves a private pin into this member's personal pin
            // list server-side; the config refresh clears the private state
            // the link notice reads.
            await Promise.all([
              refreshAgentList(),
              refreshWorkspaceUserPreference(),
              refreshAgentConfig(agentId),
            ]);
            revealSidebarSection('agent');
            toast.success(t('agent.publishToWorkspaceSuccess'));
          } catch (error) {
            console.error('Failed to publish agent:', error);
            const publishErrorKey = getAgentPublishErrorKey(error);
            toast.error(
              publishErrorKey ? t(publishErrorKey) : t('operationFailed', { ns: 'common' }),
            );
          }
        },
        title: t('agent.publishToWorkspace'),
      }),
    [refreshAgentConfig, refreshAgentList, refreshWorkspaceUserPreference, revealSidebarSection, t],
  );
};
