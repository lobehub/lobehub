'use client';

import isEqual from 'fast-deep-equal';
import { Bot } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSelect from '@/features/ModelSelect';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';

import {
  WorkspaceAgentPolicyCard,
  WorkspaceAgentSelectionPolicyMenu,
} from './WorkspaceAgentPolicyCard';

interface WorkspaceAgentModelPolicyProps {
  agentId: string;
}

export const WorkspaceAgentModelPolicy = memo<WorkspaceAgentModelPolicyProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const config = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const isWorkspaceAgent = useAgentStore(agentByIdSelectors.isWorkspaceAgentById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const isLocked = config.agencyConfig?.modelSelectionPolicy !== 'member';

  if (!isWorkspaceAgent) return null;

  return (
    <WorkspaceAgentPolicyCard
      icon={Bot}
      title={t('settingAgent.modelPolicy.title')}
      action={
        <WorkspaceAgentSelectionPolicyMenu
          disabled={!canEdit}
          locked={isLocked}
          lockedLabel={t('settingAgent.selectionPolicy.membersCannotSwitch')}
          unlockedLabel={t('settingAgent.selectionPolicy.membersCanSwitch')}
          onChange={(locked) => {
            if (!canEdit) return;

            void updateAgentConfigById(agentId, {
              agencyConfig: {
                modelSelectionPolicy: locked ? 'fixed' : 'member',
              },
            });
          }}
        />
      }
    >
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
