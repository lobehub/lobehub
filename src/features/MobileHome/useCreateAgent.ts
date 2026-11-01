import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';

export const useCreateAgent = () => {
  const { t } = useTranslation('chat');
  const { allowed, reason } = usePermission('create_content');
  const createAgent = useAgentStore((s) => s.createAgent);
  const fetchAgentList = useHomeStore((s) => s.fetchAgentList);
  const navigate = useWorkspaceAwareNavigate();
  const [loading, setLoading] = useState(false);

  const create = async (options?: {
    groupId?: string;
    pinned?: boolean;
    visibility?: 'private' | 'public';
  }) => {
    if (!allowed || loading) return;
    setLoading(true);
    try {
      let agentId: string;
      try {
        ({ agentId } = await createAgent({
          groupId: options?.groupId,
          visibility: options?.visibility,
        }));
      } catch (error) {
        console.error('Failed to create agent:', error);
        toast.error(t('sessionGroup.createAgentFailed'));
        return;
      }

      navigate(`/agent/${agentId}`);
      let hasWarnings = false;

      if (options?.pinned) {
        try {
          await agentService.updateAgentPinned(agentId, true);
        } catch (error) {
          hasWarnings = true;
          console.error('Failed to pin the created agent:', error);
          toast.warning(t('sessionGroup.createAgentPinFailed'));
        }
      }

      try {
        await fetchAgentList();
      } catch (error) {
        hasWarnings = true;
        console.error('Failed to refresh the list after creating an agent:', error);
        toast.warning(t('sessionGroup.createAgentRefreshFailed'));
      }

      return { agentId, hasWarnings };
    } finally {
      setLoading(false);
    }
  };
  return { allowed, create, loading, reason };
};
