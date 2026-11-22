import type { LobeAgentConfig, MetaData } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { shallow } from 'zustand/shallow';

import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/** Everything the advanced settings page edits, for the active agent. */
export const useAgentAdvancedSettings = () => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [agentId, isInbox] = useAgentStore(
    (s) => [s.activeAgentId, builtinAgentSelectors.isInboxAgent(s)],
    shallow,
  );
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const enableAgentGraphConfigLab = useUserStore(labPreferSelectors.enableAgentGraphConfig);

  const updateConfig = async (next: Partial<LobeAgentConfig>) => {
    if (!canEdit || !agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentConfig(agentId, next);
  };

  const updateMeta = async (next: Partial<MetaData>) => {
    if (!canEdit || !agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentMeta(agentId, next);
  };

  return {
    agentId,
    canEdit,
    config,
    meta,
    showGraph: !!enableAgentGraphConfigLab && !isInbox && !isHeterogeneous,
    updateConfig,
    updateMeta,
  };
};
