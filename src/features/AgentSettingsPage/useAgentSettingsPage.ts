import type { LobeAgentConfig, MetaData } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

/** The active agent's config and meta, with writes gated on edit permission. */
export const useAgentSettingsPage = () => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const agentId = useAgentStore((s) => s.activeAgentId);
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);

  const updateConfig = async (next: Partial<LobeAgentConfig>) => {
    if (!canEdit || !agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentConfig(agentId, next);
  };

  const updateMeta = async (next: Partial<MetaData>) => {
    if (!canEdit || !agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentMeta(agentId, next);
  };

  return { agentId, canEdit, config, meta, updateConfig, updateMeta };
};
