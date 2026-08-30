'use client';

import { Bot } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSelect from '@/features/ModelSelect';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { useAgentConfig, useAgentData } from '@/store/agent/projection';

import { WorkspaceAgentPolicyCard } from './WorkspaceAgentPolicyCard';

interface WorkspaceAgentModelPolicyProps {
  agentId: string;
}

export const WorkspaceAgentModelPolicy = memo<WorkspaceAgentModelPolicyProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const config = useAgentConfig(agentId);
  const agent = useAgentData(agentId);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  if (!agent?.workspaceId || !config) return null;

  // Whether members may switch this model is configured on the Agent's
  // Permission page — this card only picks the model itself.
  return (
    <WorkspaceAgentPolicyCard icon={Bot} title={t('settingAgent.modelPolicy.title')}>
      <ModelSelect
        disabled={!canEdit}
        style={{ width: '100%' }}
        value={{
          model: config.model,
          provider: config.provider,
        }}
        onChange={(value) => {
          if (!canEdit) return;

          void updateAgentConfigById(agentId, value);
        }}
      />
    </WorkspaceAgentPolicyCard>
  );
});

WorkspaceAgentModelPolicy.displayName = 'WorkspaceAgentModelPolicy';
